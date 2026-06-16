#!/usr/bin/env bash
# AWS デプロイ。CodePipeline/CodeBuild の buildspec から呼ばれるが、ロジックはここに集約（§5.2）。
# CI エンジンが変わってもこのスクリプトは不変＝差し替え可能なシーム。
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_DIR="infra/envs/mdcollab-aws"

echo "==> check (typecheck + test)"
make check

echo "==> terraform apply ($ENV_DIR)"
terraform -chdir="$ENV_DIR" init -input=false
terraform -chdir="$ENV_DIR" apply -auto-approve -input=false

# RDS は VPC 内 → このスクリプトは VPC 接続した CodeBuild 内で実行する想定。
# あるいは Lambda マイグレーションランナーを invoke する（§5.2 / リスク表）。
echo "==> db migrate (in-VPC)"
make migrate

echo "==> deploy api (Lambda/Fargate は terraform で更新済み or 別途 push)"
# 例: aws lambda update-function-code ... / aws ecs update-service ...

echo "==> smoke test"
curl -fsS "${BASE_URL:?BASE_URL required}/health" >/dev/null && echo "health OK"
