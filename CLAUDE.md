# mdcollab — プロジェクト指針

## docs は参考・真実はコード/設定（最重要）
`docs/` や `*/IMPORT.md` 等は陳腐化しうる。手順・秘密・設定を扱うときは **docs を鵜呑みにせず実ファイルで裏を取る**。docs が実態とズレていたら、その場で docs を実態に合わせて直す（古い手順をそのまま実行しない）。

## source of truth（迷ったらここを見る）
- **wrangler 設定**: `wrangler.toml` は生成物。真実は `wrangler.template.toml` + `.env` / GitHub Variables（`scripts/gen-wrangler.sh` が生成）。`wrangler.toml` は直接編集しない。
- **インフラの秘密配線**（cloudflare env）: `infra/envs/mdcollab-cloudflare/.envrc` = `dotenv` が同ディレクトリの gitignore 済み `.env`（`CLOUDFLARE_API_TOKEN`）を direnv で自動 export。`terraform.tfvars`（gitignore 済み）に `neon_password` / `account_id` / `zone_id` / `r2_bucket_name` / `neon_host` → tofu が自動で読む。**都度 export ではない**（その dir に cd・初回 `direnv allow`）。非対話シェル（`!` 経由）では direnv が発火しない点に注意。
- **アプリ実行の秘密**: `.dev.vars`（`.envrc` の `dotenv_if_exists` が読む）。
- **DB スキーマ**: `src/db/schema.ts` + `drizzle/`（マイグレーションは生成物）。
- **進捗 / 残タスク**: GitHub issues（`docs/archive/` は役目を終えた歴史記録）。

## 運用
- `main` は保護（PR + `check` 必須）。直 push 不可 → ブランチ + PR。
- テスト / 型: `bun run test`（pglite・docker 不要） / `bun run typecheck`。
- 依存追加は `bun add`（`package.json` にバージョンを手書きしない）。
