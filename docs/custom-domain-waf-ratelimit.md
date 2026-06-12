# 独自ドメイン + WAF レート制限（厳密版）手順書

**目的**: `*.workers.dev` 上では Cloudflare の WAF レート制限ルール（ゾーン単位・正確）が使えず、
Workers の `[[ratelimits]]` バインディングは公式に *best-effort（permissive・結果整合・コロ単位）* で
中規模バーストを厳密にブロックしない。**独自ドメイン（Cloudflare ゾーン）に載せると、コード変更ゼロで
ダッシュボードから厳密なレート制限が設定できる。**

> ステータス: 未実行（本書は手順のみ）。実行は任意のタイミングで。

## 全体像

```
ユーザー → md.example.com（Cloudflare ゾーン・WAF レート制限） → Worker(mdcollab-api)
           workers.dev 経路は無効化して迂回を塞ぐ
```

ポイント: **WAF はゾーン（ドメイン）単位**なので、workers.dev を残したままだと攻撃者が
workers.dev URL を直接叩いて WAF を迂回できる。**最終的に入口は独自ドメインだけにする。**

---

## 0. 前提

- 使う独自ドメイン（例: `example.com`）を **Cloudflare にゾーンとして追加済み**
  （ネームサーバを Cloudflare に向け、Active になっている）。Worker と同一アカウント。
- 本番サブドメイン名を決める（例: `md.example.com`）。

## 1. Worker にカスタムドメインを割り当て

**方法A（推奨・IaC 寄り）**: `wrangler.toml` に追記して `wrangler deploy`。

```toml
[[routes]]
pattern = "md.example.com"
custom_domain = true
```

`custom_domain = true` だと Cloudflare が DNS レコードと証明書（Universal SSL）を自動作成する。

**方法B（ダッシュボード）**: Workers & Pages → `mdcollab-api` → Settings → Domains & Routes
→ Add → **Custom Domain** → `md.example.com`。

## 2. BASE_URL と Google OAuth を新ドメインへ

1. `wrangler.toml` の `[vars]` の `BASE_URL` を新ドメインに変更 → デプロイ（`bun run deploy` か push）。
   ```toml
   BASE_URL = "https://md.example.com"
   ```
   - `BASE_URL` は OAuth の `redirect_uri` 生成に使われるため**必須**。
2. Google Cloud Console → 該当 OAuth クライアント → **承認済みのリダイレクト URI** に追加:
   ```
   https://md.example.com/api/auth/callback
   ```
   （workers.dev 側 URI は移行確認後に削除してよい）

## 3. workers.dev 経路を無効化（迂回防止・重要）

- ダッシュボード Workers & Pages → `mdcollab-api` → Settings → Domains & Routes
  → `mdcollab-api.<account>.workers.dev` を **Disable**。
- これを行わないと、ゾーン WAF を迂回して workers.dev へ直接アクセスできてしまう。
- 無効化後、本番入口は `md.example.com` のみになる。

## 4. WAF レート制限ルールを作成（ゾーン側・正確）

ダッシュボード → 対象ゾーン（`example.com`）→ **Security → WAF → Rate limiting rules → Create rule**。

**例: ログイン保護**
- When incoming requests match:
  `(http.request.uri.path starts_with "/api/auth/")`
- Rate limiting characteristics（カウント単位）: **IP address**（CF-Connecting-IP）
- When rate exceeds: **30 requests / 1 minute**（数値はプランの粒度に合わせて）
- Then take action: **Block**（または Managed Challenge）/ Duration: 1 minute

**任意: AI レビュー保護（コスト保護）**
- `(http.request.uri.path contains "/review")`
- IP 単位・例 20 requests / 1 minute・Block

> プラン注意: 無料プランは Rate limiting rules が**1本のみ・カウント単位や duration に制限**がある。
> 現行のプラン上限・利用可能オプションは**ダッシュボードで確認**すること（プランで変動するため固定値で書かない）。
> 複数ルールや高度な条件が必要なら Pro 以上を検討。

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

- 問題時は workers.dev 経路を再有効化し、`BASE_URL` と OAuth リダイレクト URI を元に戻す。

## 補足: Terraform 化（将来・任意）

WAF レート制限ルールは `cloudflare_ruleset`（phase = `http_ratelimit`）で IaC 化できる。
ただし現状の Terraform（`infra/envs/mdcollab-cf-personal/`）は R2/Hyperdrive のみ管理で、
ゾーンは未管理。ゾーンとルールセットを Terraform に載せるなら別途 import/記述する
（provider バージョンは導入時に最新を確認）。
