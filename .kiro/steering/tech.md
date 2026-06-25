# Technology Stack

## Architecture

**ランタイム非依存コア + アダプタ層（移植シーム）**。`src/app.ts` の `createApp(deps)` が Web 標準（Hono）のコアを組み立て、ランタイム固有の配線（DB 接続・本体ストア・非同期・環境変数）は `src/adapters/` が `Deps` として注入する。同じコアが Cloudflare Workers / Node / Lambda で動く。フロントは独立した SPA（`web/`）で、ビルド成果物を Worker の `[assets]` で同居配信する。

## Core Technologies

- **Language**: TypeScript（strict）
- **Runtime / PM**: Bun（開発・スクリプト・テスト）。デプロイ先は Workers / Node / Lambda
- **Backend**: Hono（API）
- **Frontend**: React 19 + Vite + TanStack Router / TanStack Query + Tailwind v4（SPA）

## Key Libraries

開発パターンに影響する主要ライブラリのみ:

- **drizzle-orm + postgres.js** — Postgres 一本化。Hyperdrive 経由で任意の Postgres、`prepare:false`
- **jose** — 自前 Google OIDC（IDトークン検証・自前セッション）
- **aws4fetch** — `S3Storage`（R2 / S3 / GCS）への署名リクエスト
- **marked + DOMPurify** — Markdown 描画（`renderMarkdown` は必ず DOMPurify を通す）
- AI は外部 SDK を使わず `src/llm/providers.ts` で **実 HTTP を直接実装**（`complete` / `stream` / `converse`=tool use）

## Development Standards

### Type Safety
TypeScript strict。型チェックは `tsc --noEmit`（バック / `web` 各々）。

### バージョンの扱い（重要）
外部バージョンを記憶で書かない。依存追加は `bun add`（`package.json` に手書きしない）。GitHub Actions は SHA ピン、Docker タグ等もレジストリで最新確認。

### Testing
Vitest。バックは **pglite で実 DB 相当を再現（docker 不要）**。`main` は保護で PR + `check`（CI）必須・直 push 不可。

## Development Environment

### Common Commands
```bash
bun run test          # vitest（pglite・docker不要）
bun run typecheck     # tsc --noEmit
bun run dev           # Node アダプタでローカル起動
cd web && bun run dev # フロント開発サーバ（vite）
bun run db:generate   # drizzle マイグレーション生成
```

## Key Technical Decisions

- **自前 Google OIDC**（Cloudflare Access は不採用）— 任意ランタイムで動かすため
- **`DocumentStore` インターフェイスで本体ストアを隔離** — 採用は `S3Storage`（R2）。`DriveStorage` は方針A（全移行）採用で退役・stub 残置
- **Postgres へ一本化**（移植コスト最小・標準 SQL）
- **秘密情報（AI キー / GitHub PAT）は AES-GCM 暗号化**（Web Crypto、`src/crypto.ts`）
- **デプロイ実体は `scripts/` に集約**し CI（GitHub Actions）から呼ぶだけにする（CI エンジン差し替え可能）
- **IaC は Terraform / OpenTofu**（`infra/modules` + `infra/envs/mdcollab-{cloudflare,aws,gcp}`）。状態を持つ R2 / Hyperdrive 等を管理
- **生成物は直接編集しない**: `wrangler.toml`（真実は `wrangler.template.toml` + `.env`）、`drizzle/`（真実は `src/db/schema.ts`）

---
_Document standards and patterns, not every dependency_
_updated_at: 2026-06-26_
