# Project Structure

## Organization Philosophy

**バックエンドは関心ごとのレイヤード + 移植シーム、フロントは独立 SPA** という二本立て。バックエンド（`src/`）はランタイム非依存コアを中心に層で分け、ランタイム差はアダプタに閉じ込める。フロントエンド（`web/`）は TanStack のファイルベースルーティング SPA で、API 越しにのみバックエンドへ接続する。

## Directory Patterns

### ポータブルコア + アダプタ（`src/`）
**Location**: `src/app.ts`（`createApp(deps)`）/ `src/adapters/`
**Purpose**: コアはランタイムを知らない。`adapters/cloudflare.ts`・`adapters/node.ts` が DB・ストア・環境などを `Deps` として組み立て注入する。新しいデプロイ先は**アダプタを足すだけ**で、コアは触らない。

### HTTP ルート（`src/routes/`）
**Purpose**: 機能ごとに Hono ルータを 1 ファイル（documents / comments / reviews / members …）。`app.ts` が `/api*` に結線する。認可は `auth/middleware.ts` の `requireMember` / `requireOwner` を各ルータで通す。

### インターフェイスで隔離する差し替え点
**Location**: `src/storage/types.ts`（`DocumentStore`）・`src/llm/types.ts`
**Purpose**: 本体ストアや LLM プロバイダは**インターフェイス越し**。実装（`storage/s3.ts`、`llm/providers.ts`）はファクトリ（`storage/index.ts`）で選ぶ。退役した実装は stub を残置（例 `storage/drive.ts`）。

### フロント SPA（`web/src/`）
**Purpose**: `routes/`（ファイルベースルーティング）/ `components/`（UI）/ `lib/`（純粋ロジック: `markdown.ts`・`highlight.ts`）/ `api/`（`client.ts` + `hooks.ts` で fetch を TanStack Query に束ねる）。サーバ通信は必ず `api/` 層を経由する。

## Naming Conventions

- **バックエンドの .ts**: 関心名の小文字（`reviewAgent.ts`・`middleware.ts`・`schema.ts`）
- **フロントの コンポーネント**: `PascalCase.tsx`（`AiReviewPanel.tsx`）
- **フロントの ルート**: TanStack のドット記法（`folders.$folderId.tsx`・`documents.$documentId.tsx`）
- **純粋ロジック / フック**: `web/src/lib/*.ts`・`web/src/api/hooks.ts`

## Import Organization

**パスエイリアスは未使用**。外部パッケージ以外は**相対 import** で統一する。

```typescript
import { Hono } from "hono";              // 外部パッケージ
import { renderMarkdown } from "../lib/markdown"; // 内部は相対
import schema from "../db/schema";
```

## Code Organization Principles

- **依存の向き**: `routes` → `auth`/`db`/`storage`/`llm`/`ai`/`github`、ランタイム固有は `adapters` のみ。コア（`app.ts` ほか）からアダプタへ依存しない（注入で逆転）。
- **フロントはサーバ状態を直接持たない**: 取得・変更は `web/src/api/`（TanStack Query）に集約。
- **生成物 vs 真実**: `wrangler.toml` / `drizzle/` 等は生成物。真実は `wrangler.template.toml` + `.env` / `src/db/schema.ts`。生成物を直接編集しない。
- **インフラ**: `infra/modules` + `infra/envs/mdcollab-{cloudflare,aws,gcp}`（状態を持つ資源のみ管理）。

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
_updated_at: 2026-06-26_
