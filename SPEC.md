# SPEC — mdcollab

Markdown 共同編集 + コメントスレッド + AI レビュー(GAS 版 `md-collab` の脱 GAS 後継)。
**本番稼働中**(Cloudflare)。挙動ルールの詳細は `CLAUDE.md`、残タスクは GitHub issues が正。

## 目的

Web 標準コア(Hono)を1本書き、Cloudflare / AWS / GCP のいずれにもデプロイできる
ポータブルな Markdown 共同編集基盤。差分はアダプタ層(DB / ストア / 認証 / 非同期 / CI)に閉じ込める。

## 確定事項(再議論禁止)

- **コアはランタイム非依存**: `src/app.ts` の `createApp(deps)`。ランタイム差は `src/adapters/`
  (cloudflare.ts / node.ts)のみに置く。コアに特定ランタイムの型を持ち込まない
- **DB**: Postgres + Drizzle。Hyperdrive 経由のため `prepare: false`
- **本体ストア**: `DocumentStore` インターフェース + `S3Storage`(aws4fetch)。
  `DriveStorage` は退役済み(方針A=R2 へ全移行。stub 残置)— 復活させない
- **認証**: 自前 Google OIDC(jose)。Cloudflare Access は不採用
- **フロント**: React 19 + Vite + TanStack Router/Query + Tailwind v4。Worker の `[assets]` で同居配信
- **AI レビューは tool use エージェント**(`src/ai/reviewAgent.ts`)。provider は anthropic / openai
- **`wrangler.toml` は生成物**。真実は `wrangler.template.toml` + `.env` / GitHub Variables。直接編集しない
- **IaC**: Terraform / OpenTofu(`infra/envs/mdcollab-{cloudflare,aws,gcp}`)。秘密の配線は direnv
  (詳細は CLAUDE.md「インフラの秘密配線」)
- **main は保護**(PR + check 必須)。直 push 不可
- docs は参考、**真実はコード/設定**。ズレていたら docs をその場で直す
- 依存追加は `bun add`。バージョン手書き禁止

## スコープ外

- Google Drive ストレージの再サポート
- Cloudflare Access ベースの認証への移行

## アーキテクチャ

README「構成」セクションが正(src/ のレイアウトと各層の責務)。routes は全11本。

## DO / DO NOT

- DO: 変更後は `bun run typecheck && bun run test`(pglite、docker 不要)
- DO: AI レビュー周りを触ったら `bun run eval:review:gate`
- DO NOT: `wrangler.toml` を直接編集しない
- DO NOT: docs の手順を鵜呑みに実行しない(実ファイルで裏を取る)
- DO NOT: eval の baseline 相当を勝手に更新しない

## 検証手順(E2E)

1. `bun run typecheck && bun run test`
2. ローカル実起動: `make up && make migrate` → `bun run dev`(`DEV_AUTH=1`、手順は docs/local-dev.md)
3. `http://localhost:8787/health` が 200
