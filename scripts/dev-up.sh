#!/usr/bin/env bash
# ローカル検証環境のワンショット下準備: バッキングサービス(Postgres + S3) + スキーマ + seed。
# 既存の docker-compose.yml / .dev.vars / make ターゲットを束ねるだけ（再発明しない）。
#   make dev-up   # 下準備だけ（サーバは起動しない）
#   make serve    # 下準備 + backend/web を起動（内部で本スクリプトを呼ぶ）
# すべて冪等（何度実行しても安全）。⚠ DEV_AUTH=1 前提＝本番では絶対に使わない。
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) .dev.vars を用意（無ければ example から作成）
if [ ! -f .dev.vars ]; then
  echo "==> .dev.vars が無いので .dev.vars.example から作成（SEED_EMAIL を自分のメールに変更推奨）"
  cp .dev.vars.example .dev.vars
fi
set -a
# shellcheck disable=SC1091
. ./.dev.vars
set +a

# 2) Postgres + S3(SeaweedFS) を起動し healthcheck 完了まで待つ
echo "==> docker compose up -d --wait (postgres + s3)"
docker compose up -d --wait

# 3) マイグレーション + seed（どちらも冪等）。S3 バケットは seed の初回 PUT で自動生成。
echo "==> db migrate"
bun run db:migrate
echo "==> seed (SEED_EMAIL=${SEED_EMAIL:-you@example.com})"
bun run seed

echo ""
echo "  ✅ ローカル検証環境の準備完了。"
echo "     dev ログイン URL（Google 不要・1回開けばセッション発行）:"
echo "       http://localhost:5173/api/auth/dev-login?email=${SEED_EMAIL:-you@example.com}"
echo ""
