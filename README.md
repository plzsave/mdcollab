# mdcollab

Markdown 共同編集 + コメントスレッド + AI レビュー。GAS 版 `md-collab` の脱 GAS 後継。

**ポータブル一本化**: Web標準コア（Hono）を1本書き、個人は Cloudflare、職場は AWS にデプロイ。
差は **アダプタ層（DB / 本体ストア / 認証 / 非同期 / CI）だけ**。設計の根拠は別リポの計画書
（`md-collab-migration-plan.md`）と API 契約（`mdcollab-api-inventory.md`）を参照。

> ⚠ これは **Phase 0（土台）のスケルトン**。読み取り系の一部ルートと各シームの実装パターンを通しただけで、
> 全 API（`mdcollab-api-inventory.md` の 45 RPC）は未実装。

## スタック

| 層 | 採用 | 備考 |
|---|---|---|
| API | Hono | Web標準。Workers/Node/Lambda 共通 |
| DB | Postgres + Drizzle | 個人=Neon(Hyperdrive) / 職場=RDS。`prepare:false` |
| 本体ストア | `DocumentStore` I/F | `S3Storage`(R2/S3/GCS, aws4fetch) / `DriveStorage`(Phase 0で実装) |
| 認証 | 自前 Google OIDC | jose。Cloudflare Access は不採用 |
| IaC | Terraform | `infra/modules` + `infra/envs/mdcollab-*` |
| CI | 個人=GitHub Actions / 職場=CodePipeline | デプロイ実体は `scripts/` に集約 |

## 構成

```
src/
  app.ts              # ランタイム非依存のコア（createApp(deps)）
  env.ts              # Deps / AppConfig
  adapters/           # 移植シーム: cloudflare.ts(Workers) / node.ts(Node/Lambda)
  auth/               # oidc.ts / session.ts / middleware.ts（requireMember/Owner）
  db/                 # schema.ts(§6.1) / client.ts(postgres.js)
  storage/            # types.ts(DocumentStore) / s3.ts / drive.ts / index.ts(factory)
  routes/             # auth, state, folders, documents（API 契約の一部を実装）
infra/                # Terraform（modules + envs/mdcollab-{cf-personal,aws-workplace,gcp}）
scripts/              # deploy-cf.sh / deploy-aws.sh（CI はこれを呼ぶだけ）
```

## 開発

```bash
bun install
bun run typecheck
bun run test
cp .dev.vars.example .dev.vars   # 値を埋める
direnv allow                     # 初回だけ。以後 cd で .dev.vars が自動読み込み
bun run dev                      # http://localhost:8787/health
```

DB マイグレーション: `bun run db:generate` → `bun run db:migrate`。

### ローカル実起動の検証

バッキングサービス（Postgres + S3互換）を docker-compose で建て、アプリはホストで動かす。
**Google OAuth は不要**（`DEV_AUTH=1` の dev ログインを使う）。手順は **[docs/local-dev.md](docs/local-dev.md)**。

```bash
cp .dev.vars.example .dev.vars   # SEED_EMAIL を自分のメールに
direnv allow   # 初回だけ。以後 cd するだけで .dev.vars が自動で環境変数化される
make up        # postgres + SeaweedFS S3
make migrate   # スキーマ適用
make seed      # member + folder + document を投入
bun run dev    # http://localhost:8787
```

S3 互換ストアは **SeaweedFS** を採用（MinIO/LocalStack 不使用・軽量単一プロセス・固定キー即利用）。
別実装にしたい場合は `docker-compose.yml` の `s3` サービスを差し替え、`S3_ENDPOINT` を合わせるだけ
（アプリは path-style なので無改修）。本物の Google ログインを試す手順は **[docs/google-oauth-setup.md](docs/google-oauth-setup.md)**。

## 自分の環境へデプロイ（Cloudflare）

このリポジトリは**個人のアカウント値をコミットしない**設計。`wrangler.toml` は
`wrangler.template.toml` + 環境変数から **`scripts/gen-wrangler.sh` が生成**する（生成物は gitignore 済み）。
fork した人は **tracked ファイルを編集せず**、自分の値を `.env`（ローカル）/ GitHub Variables・Secrets（CI）に入れるだけ。

```bash
# 1) ランタイム秘密を投入（一度だけ）
wrangler secret put SESSION_SECRET      # ほか ENCRYPTION_KEY / S3_ACCESS_KEY_ID /
                                        # S3_SECRET_ACCESS_KEY / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
# 2) 非秘密の設定を .env に
cp .env.example .env                    # BASE_URL / S3_ENDPOINT / S3_BUCKET / HYPERDRIVE_ID 等を記入
                                        # 独自ドメインを使うなら CUSTOM_DOMAIN も設定（未設定なら workers.dev）
# 3) デプロイ（gen → web build → wrangler deploy）
bun run deploy
```

**CI（GitHub Actions）で自動デプロイする場合**、repo の設定に登録:

| 種別 | キー |
|---|---|
| Secrets | `CLOUDFLARE_API_TOKEN`（Workers Scripts Edit ＋ 独自ドメイン時は Zone Workers Routes/DNS Edit）/ `CLOUDFLARE_ACCOUNT_ID` |
| Variables | `BASE_URL` / `CUSTOM_DOMAIN`(任意) / `S3_ENDPOINT` / `S3_BUCKET` / `HYPERDRIVE_ID` |

状態を持つインフラ（R2 / Hyperdrive / WAF）は Terraform/OpenTofu 管理。
手順は **[infra/envs/mdcollab-cf-personal/IMPORT.md](infra/envs/mdcollab-cf-personal/IMPORT.md)**、
独自ドメイン + WAF レート制限は **[docs/custom-domain-waf-ratelimit.md](docs/custom-domain-waf-ratelimit.md)**。

## 実装済み / 未実装

進捗の正は **[docs/TODO.md](docs/TODO.md)**（残タスク台帳）。

- ✅ ポータブルコア・アダプタ2種（CF/Node）・Drizzle スキーマ・DocumentStore(S3)・OIDC/セッション・
  `requireMember/Owner`・Terraform/CI/scripts 骨組み。
- ✅ API（**バックエンドはパリティ到達**）: `setup` / `state` / `folders`(list/CRUD/文書一覧) / `documents`(全10) /
  `statuses` / `members` / `threads`・`comments`(7) / `notifications`(3) / `ai`(settings・secrets 7) /
  `reviews`(review・revision 5) ＋通知発火。linkFolder のみ保留（方針A）。
- ✅ 横断: 通知発火・AIキー暗号化保存(AES-GCM)・AIプロバイダ層(anthropic/openai)・SSEストリーミング。
- ✅ テスト: pglite + メモリストア + fake LLM の結合テスト 60 本（docker 不要・`bun run test`）。
- ⬜ 残り: 着手順5の小物（`/api/setup`・folder rename/delete/link）、`DriveStorage`、
  データ移行スクリプト、Terraform 実リソース。→ 台帳参照。

### テスト方針
`test/helpers/harness.ts` が **pglite（プロセス内 Postgres）に本番マイグレーションを適用** + **メモリ実装の
DocumentStore** + **fake LlmClient** + **本番と同じ署名クッキー**でアプリを起こす。外部サービス無しで本物の
Postgres 意味論・認可（owner/member）・楽観ロック(409)・通知の宛先・キー暗号化・SSE まで検証できる。
