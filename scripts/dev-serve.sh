#!/usr/bin/env bash
# ローカルで実画面を見るためのフルスタック起動: 下準備 → backend(:8787) + web(:5173) を同時起動。
# Ctrl-C で両方まとめて停止する。⚠ DEV_AUTH=1 前提＝本番では絶対に使わない。
#   make serve
set -euo pipefail
cd "$(dirname "$0")/.."

# 下準備（Postgres+S3 起動・migrate・seed）。冪等なので毎回呼んで良い。
./scripts/dev-up.sh

set -a
# shellcheck disable=SC1091
. ./.dev.vars
set +a

echo "==> backend(:${PORT:-8787}) と web(:5173) を起動（Ctrl-C で両方停止）"
# `bun run dev` / `bun run dev`(web) はラッパーが実体を子プロセスとして生み、
# 親を kill しても実体が残る。exec / 直接起動で BACK・WEB を実体プロセスにする。
bun run src/adapters/node.ts &
BACK=$!
( cd web && exec ./node_modules/.bin/vite ) &
WEB=$!

cleanup() {
  trap - EXIT INT TERM
  echo ""
  echo "==> 停止します…"
  kill "$BACK" "$WEB" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo ""
echo "  👉 ブラウザでまず1回このURLを開いてログイン（Google 不要）:"
echo "     http://localhost:5173/api/auth/dev-login?email=${SEED_EMAIL:-you@example.com}"
echo "  👉 その後 http://localhost:5173/ を開けば認証済みで使えます。"
echo "     （バッキングサービスは make down で停止）"
echo ""

# どちらかのサーバが落ちたら終了（trap で相方も停止）
wait -n "$BACK" "$WEB"
