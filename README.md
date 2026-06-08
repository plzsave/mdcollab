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
set -a; source .dev.vars; set +a
bun run dev                      # http://localhost:8787/health
```

DB マイグレーション: `bun run db:generate` → `bun run db:migrate`。

## 実装済み / 未実装

- ✅ ポータブルコア・アダプタ2種（CF/Node）・Drizzle スキーマ・DocumentStore(S3)・OIDC/セッション・
  `requireMember/Owner`・`/health` テスト・Terraform/CI/scripts 骨組み。
- ⬜ 残り API（threads/comments/members/notifications/AI review…）、`DriveStorage`、AI ストリーミング、
  データ移行スクリプト、Terraform 実リソース。→ Phase 1 以降。
