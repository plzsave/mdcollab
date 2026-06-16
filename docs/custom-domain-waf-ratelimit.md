# 独自ドメイン + WAF レート制限（厳密版）手順書 — IaC 版

**目的**: `*.workers.dev` 上では Cloudflare の WAF レート制限ルール（ゾーン単位・正確）が使えず、
Workers の `[[ratelimits]]` バインディングは公式に *best-effort（permissive・結果整合・コロ単位）* で
中規模バーストを厳密にブロックしない。**独自ドメイン（Cloudflare ゾーン）に載せると、ダッシュボードの
手作業なしに（Terraform + wrangler）厳密なレート制限が設定できる。**

> ステータス（2026-06-13）: **§1〜4 完了**。本番ドメイン `md.example.com` に移行し、
> health・ログイン（Google→/api/auth/callback）疎通確認済み。`workers_dev = false` で
> workers.dev 経路も無効化済み（入口は独自ドメインのみ）。
> WAF レート制限ルールも `tofu apply` 済み（`cloudflare_ruleset.auth_ratelimit`）。
> **§6 検証済み**: `/api/auth/login` を 60 連打（並列20）→ `20×302 / 40×429`。閾値超過が
> 正確に 429 Block される実機確認 OK（旧 Workers binding ではバーストで 429 が返らなかった）。
> §5 AUTH_LIMITER は **残置で確定**（多層防御・フェイルオープン保険・無作業）。**＝本書の作業 完了。**
>
> 無料プラン実値（重要）: example.com は **Cloudflare 無料プラン**のため、レート制限ルールの
> **`period`（カウント窓）は 10 秒固定・`mitigation_timeout`（ブロック継続）も 10 秒**に制限される
> （`period=60` は `not entitled` で 400）。そのため実構成は **5 req / 10s per IP**（30req/60s と
> 同じ平均レート 0.5req/秒）。より長い窓・長いブロック・複数ルールが要るなら Pro 以上。
> 方針: **IaC ファースト**。Cloudflare ダッシュボードでの手作業は退避手段（フォールバック）として
> 各節末尾にのみ残す。

## 全体像

```
ユーザー → md.example.com（Cloudflare ゾーン・WAF レート制限） → Worker(mdcollab-api)
           workers.dev 経路は無効化して迂回を塞ぐ
```

ポイント: **WAF はゾーン（ドメイン）単位**なので、workers.dev を残したままだと攻撃者が
workers.dev URL を直接叩いて WAF を迂回できる。**最終的に入口は独自ドメインだけにする。**

## IaC 管理境界（この変更で何がどこに入るか）

既存方針（`infra/envs/mdcollab-cloudflare/main.tf` 冒頭）を踏襲する。
**状態を持つインフラは Terraform、Worker のスクリプト・バインディング・ルートは wrangler.toml が IaC。**

| 項目 | IaC の置き場所 | 反映コマンド |
|---|---|---|
| カスタムドメイン route | `wrangler.toml` の `[[routes]] custom_domain=true` | `bun run deploy`（push で CI も可） |
| workers.dev 経路の無効化 | `wrangler.toml` の `workers_dev = false` | 同上 |
| `BASE_URL` | `wrangler.toml` の `[vars]` | 同上 |
| WAF レート制限ルール | Terraform `cloudflare_ruleset`（phase=`http_ratelimit`） | `tofu apply` |
| ゾーン（NS 委任・Active 化） | **手動**（レジストラの NS 変更を伴う一度きりの作業） | ダッシュボード |
| Google OAuth redirect URI | **手動**（GCP 側・Cloudflare の IaC 外） | GCP コンソール |

> ゾーン本体（`cloudflare_zone`）は Terraform 化しない。NS 委任はレジストラ側の一度きりの作業で、
> import しても運用上の利点が薄いため。WAF ルールは**ゾーンを import せずとも** `zone_id` を変数で
> 渡すだけで新規 apply できる。

---

## 0. 前提（手動・一度きり）

- 使う独自ドメイン（例: `example.com`）を **Cloudflare にゾーンとして追加済み**
  （ネームサーバを Cloudflare に向け、Active になっている）。Worker と同一アカウント。
- 本番サブドメイン名を決める（例: `md.example.com`）。
- ゾーンの **Zone ID** を控える（ダッシュボードのゾーン Overview 右下、または
  `wrangler whoami` 後に API で取得）。後で Terraform の `zone_id` に使う。

## 1. カスタムドメインを Worker に割り当て（wrangler.toml）

`wrangler.toml` に route を追記して `bun run deploy`。`custom_domain = true` だと
Cloudflare が DNS レコードと証明書（Universal SSL）を自動作成する。

```toml
[[routes]]
pattern = "md.example.com"
custom_domain = true
```

> API トークン注意: CI/wrangler が使う `CLOUDFLARE_API_TOKEN` に、カスタムドメイン作成のための
> 権限（Workers Scripts Edit に加え、ゾーンの DNS Edit / Workers Routes Edit 相当）が要る。
> 既存の R2/Hyperdrive 用トークンとは別系統なので、不足する場合は権限を追加する。

<details>
<summary>フォールバック（ダッシュボード手動）</summary>

Workers & Pages → `mdcollab-api` → Settings → Domains & Routes → Add → **Custom Domain**
→ `md.example.com`。IaC と二重管理にならないよう、恒久運用は wrangler.toml を正にすること。
</details>

## 2. BASE_URL と Google OAuth を新ドメインへ

1. `wrangler.toml` の `[vars]` の `BASE_URL` を新ドメインに変更 → デプロイ（`bun run deploy` か push）。
   ```toml
   BASE_URL = "https://md.example.com"
   ```
   - `BASE_URL` は OAuth の `redirect_uri` 生成に使われるため**必須**。
2. **（手動・Cloudflare 外）** Google Cloud Console → 該当 OAuth クライアント →
   **承認済みのリダイレクト URI** に追加:
   ```
   https://md.example.com/api/auth/callback
   ```
   （workers.dev 側 URI は移行確認後に削除してよい）

## 3. workers.dev 経路を無効化（迂回防止・重要／wrangler.toml）

`wrangler.toml` のトップレベルに次を追記して `bun run deploy`。これで
`mdcollab-api.<account>.workers.dev` への公開が止まり、入口が `md.example.com` のみになる。

```toml
workers_dev = false
```

- これを行わないと、ゾーン WAF を迂回して workers.dev へ直接アクセスできてしまう。
- IaC で管理することで、再デプロイしても無効化が保たれる（ダッシュボードでの手作業 Disable は
  次のデプロイで状態が揺れる懸念があるため非推奨）。

<details>
<summary>フォールバック（ダッシュボード手動）</summary>

Workers & Pages → `mdcollab-api` → Settings → Domains & Routes →
`mdcollab-api.<account>.workers.dev` を **Disable**。恒久運用は wrangler.toml を正にすること。
</details>

## 3.5 CI（GitHub Actions）で踏んだ罠（実測・独自ドメイン移行に伴う）

独自ドメイン化で `ci.yml` の `deploy-cf` が連続で落ちた。原因と対処を記録（再実行時の備え）:

1. **CI トークンの権限不足（`Authentication error [code: 10000]` on `/zones/.../workers/routes`）**
   `custom_domain = true` を入れると `wrangler deploy` がゾーンの Workers Routes API を叩く。
   CI 用 `CLOUDFLARE_API_TOKEN`（GitHub Secret）に **Zone · Workers Routes · Edit**（＋ DNS Edit・
   対象ゾーン）を追加して解消。TF 用トークンとは別物。
2. **smoke が旧 URL を叩いて 404**
   `.github/workflows/ci.yml` の `BASE_URL` を `https://md.example.com` に更新（workers.dev は
   `workers_dev=false` で無効化済み）。
3. **smoke が CI の IP 起因で 403**
   Cloudflare ゾーンは **GitHub Actions のデータセンター IP を challenge** するため `/health` が 403
   になる（手元・実ブラウザは 200）。`scripts/deploy-cf.sh` の smoke を「403 は警告に留め、
   DNS/5xx/404 等のみ失敗」に変更（IP 起因の恒久赤を回避しつつ本物の障害は捕捉）。

## 4. WAF レート制限ルールを作成（Terraform `cloudflare_ruleset`・ゾーン側・正確）

既存の infra env（`infra/envs/mdcollab-cloudflare/`）に**ゾーン scope のルールセット**を追加する。
ゾーン本体は import 不要で、`zone_id` を変数で渡すだけ。**雛形は配置済み**（`variables.tf` の
`zone_id` と `waf.tf`）。`zone_id` が空の間は `count` ガードで不作成なので、ドメイン確定前でも
既存の R2/Hyperdrive 向け plan は No changes を保つ。

### 4-1. ゾーン ID を渡す

`variables.tf` に追加済みの変数（`default = ""`）に対し、`terraform.tfvars`（gitignore 済み）か
環境変数で渡す:

```bash
export TF_VAR_zone_id='＜ゾーン ID＞'
```

### 4-2. ルールセット（`waf.tf`・配置済み）

```hcl
resource "cloudflare_ruleset" "auth_ratelimit" {
  count = var.zone_id == "" ? 0 : 1  # zone_id 未設定なら不作成

  zone_id = var.zone_id
  name    = "mdcollab auth rate limiting"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules = [{
    action      = "block"
    description = "auth endpoints: 30 req / 60s per IP"
    enabled     = true
    expression  = "starts_with(http.request.uri.path, \"/api/auth/\")"
    ratelimit = {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = 60
      requests_per_period = 30
      mitigation_timeout  = 60
    }
  }]
}
```

> スキーマ注意: cloudflare provider は v5 系で v4 から大きく変わった（`rules` がブロックから
> **属性リスト** `rules = [{...}]` へ）。上記は v5 想定。**apply 前に導入済み provider
> （現状 `~> 5.19`）の registry ドキュメントで `cloudflare_ruleset` の rate limit フィールド名
> （`requests_per_period` / `period` / `mitigation_timeout` / `characteristics`）を確認**すること。
> バージョン番号・フィールド名はトレーニング知識ではなくレジストリから引く。

### 4-3. 反映

```bash
export PATH="$HOME/.local/bin:$PATH"
cd infra/envs/mdcollab-cloudflare
tofu plan    # auth_ratelimit の新規作成 1件だけが出ること（R2/Hyperdrive は No changes）
tofu apply
```

### 任意: AI レビュー保護（コスト保護・2本目のルール）

```hcl
# 上の rules 配列に追記、または別 resource で。
{
  action      = "block"
  description = "AI review: 20 req / 60s per IP"
  enabled     = true
  expression  = "http.request.uri.path contains \"/review\""
  ratelimit = {
    characteristics     = ["ip.src", "cf.colo.id"]
    period              = 60
    requests_per_period = 20
    mitigation_timeout  = 60
  }
}
```

> プラン注意（実測済み）: example.com の無料プランでは **`period=10`・`mitigation_timeout=10` の
> 10 秒固定**、Rate limiting rules は **1本のみ**。`period=60` 等は `not entitled to use the period 60,
> can only use a period among [10]` で 400 になる。2本目以降や長い窓・長いブロックが要るなら Pro 以上。
> 現行のプラン上限はダッシュボードで確認（プランで変動するため固定値で書かない）。

<details>
<summary>フォールバック（ダッシュボード手動）</summary>

対象ゾーン → **Security → WAF → Rate limiting rules → Create rule**。
When match: `(http.request.uri.path starts_with "/api/auth/")` / characteristics: **IP address** /
exceeds: **30 requests / 1 minute** / action: **Block**（または Managed Challenge）/ Duration: 1 minute。
手動作成したルールは Terraform 管理外になるため、IaC と二重に作らないこと。
</details>

## 5. （任意）Worker 側 AUTH_LIMITER の扱い

WAF で厳密に効くようになれば、Worker の `AUTH_LIMITER`（best-effort）は冗長。
- 残す: 多層防御として無害（フェイルオープン）。
- 撤去する: `wrangler.toml` の `[[ratelimits]]` ブロックと、`src/adapters/cloudflare.ts` の
  `/api/auth/*` レート制限ブロックを削除 → デプロイ。

## 6. 検証

```bash
# 新ドメインで疎通
curl -fsS https://md.example.com/health           # {"ok":true}

# ブラウザでログイン一連（Google → /api/auth/callback → アプリ）が新ドメインで通る

# レート制限（閾値超で 429 / challenge になる）
seq 1 60 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  https://md.example.com/api/auth/login | sort | uniq -c

# workers.dev が無効化され、直アクセスが到達しないこと
curl -si https://mdcollab-api.<account>.workers.dev/health | head -1
```

## ロールバック

- WAF ルール: `tofu destroy -target=cloudflare_ruleset.auth_ratelimit`（または `waf.tf` を消して apply）。
- 経路: `wrangler.toml` の `workers_dev = false` を外し、`[[routes]]` を削除して再デプロイ。
- `BASE_URL` と OAuth リダイレクト URI を元に戻す。

## 補足: API トークン権限のまとめ

| 用途 | 必要権限 | 渡し方 |
|---|---|---|
| wrangler deploy（route/custom domain 含む） | Workers Scripts Edit ＋ Zone DNS Edit / Workers Routes Edit | `CLOUDFLARE_API_TOKEN`（CI Secret / 端末） |
| Terraform（WAF ルールセット） | Zone · **WAF** · Edit（＋既存の R2/Hyperdrive 権限） | `CLOUDFLARE_API_TOKEN`（端末） |

> 秘密（API トークン・ゾーン ID は秘密ではないが運用上は env で）は**自分の端末で**設定・実行する
> （会話ログに残さないため）。Terraform state はローカル（gitignore 済み）。
