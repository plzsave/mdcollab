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
  # 独自ドメイン(Cloudflare ゾーン)移行後、CI(GitHub Actions のデータセンター IP)は
  # Cloudflare に challenge され /health が 403 になることがある（手元・実ブラウザは 200）。
  # 本物の障害(DNS/5xx/404)は失敗させ、IP 起因の 403 は警告に留めて緑を保つ。
  code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" || echo 000)
  case "$code" in
    200) echo "health OK" ;;
    403) echo "::warning::smoke /health=403 (Cloudflare が CI のデータセンター IP を challenge)。デプロイ成功・公開疎通は別途確認。" ;;
    *)   echo "smoke FAILED: HTTP $code"; exit 1 ;;
  esac
fi
