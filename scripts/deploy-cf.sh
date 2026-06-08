#!/usr/bin/env bash
# 個人(Cloudflare)デプロイ。GitHub Actions から呼ばれるが、ロジックはここに集約（§5.2）。
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_DIR="infra/envs/mdcollab-cf-personal"

echo "==> check (typecheck + test)"
make check

echo "==> terraform apply ($ENV_DIR)"
terraform -chdir="$ENV_DIR" init -input=false
terraform -chdir="$ENV_DIR" apply -auto-approve -input=false

echo "==> db migrate (Neon は公開エンドポイントのため直接実行可)"
make migrate

echo "==> deploy Workers"
bunx wrangler deploy

echo "==> smoke test"
curl -fsS "${BASE_URL:?BASE_URL required}/health" >/dev/null && echo "health OK"
