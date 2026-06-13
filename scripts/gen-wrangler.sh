#!/usr/bin/env bash
# wrangler.template.toml + 環境変数 → wrangler.toml を生成する。
#   - ローカル: リポジトリ直下の .env から値を読む（.env は gitignore 済み）
#   - CI: GitHub Variables/Secrets が env として渡される（.env は無い）
# 個人のアカウント値（ドメイン/エンドポイント/Hyperdrive ID 等）をコミットしないための仕組み。
set -euo pipefail
cd "$(dirname "$0")/.."

# .env があれば読み込む（CI には無い）。set -a で全代入を export する。
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# 必須値の検証（未設定なら分かりやすく失敗）
: "${BASE_URL:?BASE_URL が未設定です（.env か GitHub Variables に設定）}"
: "${S3_ENDPOINT:?S3_ENDPOINT が未設定です}"
: "${S3_BUCKET:?S3_BUCKET が未設定です}"
: "${HYPERDRIVE_ID:?HYPERDRIVE_ID が未設定です}"

# 既定値・派生値
export S3_REGION="${S3_REGION:-auto}"
export CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-}"
# CUSTOM_DOMAIN を設定したときだけ workers.dev を無効化する
if [ -n "$CUSTOM_DOMAIN" ]; then
  export WORKERS_DEV=false
else
  export WORKERS_DEV=true
fi

# envsubst は指定した変数だけ置換する（テンプレ中の他の $ を壊さない）
envsubst '${BASE_URL} ${S3_ENDPOINT} ${S3_BUCKET} ${S3_REGION} ${HYPERDRIVE_ID} ${WORKERS_DEV}' \
  < wrangler.template.toml > wrangler.toml

# 独自ドメインを使う場合のみ custom_domain route を付ける（未設定なら workers.dev のまま）
if [ -n "$CUSTOM_DOMAIN" ]; then
  cat >> wrangler.toml <<EOF

[[routes]]
pattern = "$CUSTOM_DOMAIN"
custom_domain = true
EOF
fi

echo "==> generated wrangler.toml (workers_dev=$WORKERS_DEV${CUSTOM_DOMAIN:+, custom_domain=$CUSTOM_DOMAIN})"
