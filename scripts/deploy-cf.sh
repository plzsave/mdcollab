#!/usr/bin/env bash
# 個人(Cloudflare)デプロイの実体。GitHub Actions / ローカルの両方から呼べる単一の入口（§5.2）。
#   - web(SPA) をビルドして web/dist を作り、wrangler で Worker ＋ [assets] をデプロイ
#   - 認証は CLOUDFLARE_API_TOKEN（CI が注入 / ローカルは wrangler login でも可）
# 方針:
#   - Terraform(apply) はここでは呼ばない（R2/Hyperdrive は手動運用・state はローカル）
#   - DB migrate もここでは自動化しない（スキーマ変更時に `make migrate` を手動実行）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> deps (root + web)"
bun install --frozen-lockfile
(cd web && bun install --frozen-lockfile)

echo "==> build web (SPA → web/dist)"
bun run build:web

echo "==> deploy Workers (+ [assets])"
bunx wrangler deploy

if [ -n "${BASE_URL:-}" ]; then
  echo "==> smoke test"
  curl -fsS "${BASE_URL}/health" >/dev/null && echo "health OK"
fi
