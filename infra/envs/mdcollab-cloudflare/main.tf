# Cloudflare デプロイのうち「状態を持つインフラ」だけを Terraform/OpenTofu 管理。
#   - 対象: R2 バケット / Hyperdrive 設定（→ Postgres）
#   - 対象外: Worker のスクリプト・バインディングは wrangler.toml + `wrangler deploy` のまま
#     （wrangler.toml 自体が Worker の IaC。TF に入れると wrangler deploy と二重管理になるため）
# state backend: まずローカル（terraform.tfstate）。必要になれば R2(S3互換) backend へ移行可。

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # 2026-06 時点の最新安定 v5 系を確認して採用（registry: 5.19.1）。
      version = "~> 5.19"
    }
  }
}

# api_token は環境変数 CLOUDFLARE_API_TOKEN から読む（このディレクトリの .env を .envrc の dotenv が
# 自動 export。実値はリポジトリに置かない＝.env は gitignore 済み）。
provider "cloudflare" {}
