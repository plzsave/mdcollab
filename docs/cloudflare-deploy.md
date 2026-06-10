# Cloudflare 手動デプロイ手順（軽い入り方）

本番（個人 Cloudflare）を **wrangler 手動デプロイ** で最短起動するための手順。
Terraform / CI はまだ使わず、まず本番 `/health` を通すことを目標にする。
ここで作った R2 / Hyperdrive は、後で `terraform import` で一括管理へ移せる（作り直し不要）。

> データ移行は不要（本番は空スタート）。MD は起動後に手動 or アプリ経由で追加する。

---

## 0. 前提（あなた側で用意するもの）

| # | 用意するもの | 取得物 |
|---|---|---|
| 1 | Neon プロジェクト | Postgres 接続文字列 `postgres://...` |
| 2 | Cloudflare アカウント | Account ID |
| 3 | Cloudflare API トークン | 権限: Workers Scripts / R2 / Hyperdrive 編集 |
| 4 | R2 有効化 | Access Key ID / Secret（S3互換） |
| 5 | Google OAuth（本番用クライアント） | Client ID / Secret |
| 6 | 秘密鍵2本 | `openssl rand -base64 32` を2回 |

ログインは1度だけ（このセッションなら `! npx wrangler login` を入力欄に打てば出力が会話に入る）:

```bash
npx wrangler login          # ブラウザ認証。CI では CLOUDFLARE_API_TOKEN を使う
npx wrangler whoami         # アカウントが出れば OK
```

---

## 1. R2 バケットを作る（本体MDストア）

```bash
npx wrangler r2 bucket create mdcollab-docs-personal
```

S3互換アクセス用のキーは **Cloudflare ダッシュボード → R2 → Manage R2 API Tokens** で発行し、
`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` として控える。エンドポイントは:

```
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

> 名前は本番想定で固定（後で Terraform import するとき散らからないように）。

---

## 2. Hyperdrive を作る（→ Neon）

```bash
npx wrangler hyperdrive create mdcollab-neon \
  --connection-string="postgres://<user>:<pass>@<neon-host>/<db>?sslmode=require"
```

出力された **id** を `wrangler.toml` の `[[hyperdrive]] id = "<HYPERDRIVE_ID>"` に貼る。

---

## 3. secrets を投入

```bash
# 自前の秘密（生成して投入）
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
openssl rand -base64 32 | npx wrangler secret put ENCRYPTION_KEY   # ⚠ 一度決めたら変えない

# Google OAuth（本番クライアント）
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# R2（S3互換）
npx wrangler secret put S3_ENDPOINT          # https://<ACCOUNT_ID>.r2.cloudflarestorage.com
npx wrangler secret put S3_BUCKET            # mdcollab-docs-personal
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY
```

非秘密（`S3_REGION` / `BASE_URL`）は `wrangler.toml` の `[vars]` 側。`BASE_URL` を自分の
Workers サブドメインに書き換える（例 `https://mdcollab-api.<you>.workers.dev`）。

> `DEV_AUTH` は **本番では絶対に設定しない**（cloudflare アダプタにも配線していない）。

---

## 4. スキーマを Neon に適用

Neon は公開エンドポイントなので、ローカルから直接マイグレーションできる:

```bash
DATABASE_URL="postgres://<user>:<pass>@<neon-host>/<db>?sslmode=require" \
  bun run db:migrate
```

---

## 5. Google OAuth の本番リダイレクト URI を承認

Google Cloud Console → 認証情報 → OAuth クライアント → 承認済みリダイレクト URI に追加:

```
https://mdcollab-api.<you>.workers.dev/api/auth/callback
```

（`src/routes/auth.ts` の `redirectUri = ${baseUrl}/api/auth/callback` と一致させること。）

---

## 6. デプロイ & スモークテスト

```bash
npx wrangler deploy
curl -fsS https://mdcollab-api.<you>.workers.dev/health && echo "  health OK"
```

`health OK` が出れば本番起動成功。次にブラウザで実 Google ログイン → setup → 文書作成まで通す。

---

## 7. 初回 setup（owner 化）

`POST /api/setup` は members が空のとき、最初に叩いた本人を owner にし既定ステータスを投入する。
本番で Google ログイン後、ブラウザ or curl（セッションクッキー付き）で1回叩く。

---

## 次の段階（後でやる）

- **Terraform 一括管理へ**: ここで作った R2 / Hyperdrive を `infra/envs/mdcollab-cf-personal` に
  `terraform import` で取り込み、Workers スクリプトも IaC 管理に移す。
- **CI（GitHub Actions）**: `scripts/deploy-cf.sh` を呼ぶだけのワークフロー。secrets は GitHub Secrets 経由。
- **AWS**: 後回し。
