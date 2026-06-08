# 個人デプロイ: Cloudflare（Workers + R2 + Hyperdrive→Neon）
# state backend: R2 (S3互換) もしくは Terraform Cloud。

terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # version は terraform init で解決（CLAUDE ルール: バージョン直書きしない）
    }
  }

  # backend "s3" {            # R2 を S3 互換 backend として利用
  #   bucket                      = "mdcollab-tfstate"
  #   key                         = "cf-personal/terraform.tfstate"
  #   region                      = "auto"
  #   endpoints                   = { s3 = "https://<acct>.r2.cloudflarestorage.com" }
  #   skip_credentials_validation = true
  #   skip_region_validation      = true
  #   skip_requesting_account_id  = true
  #   use_path_style              = true
  # }
}

provider "cloudflare" {
  # api_token は環境変数 CLOUDFLARE_API_TOKEN（CI が注入）
}

# TODO(Phase 0):
#   - cloudflare_workers_script  (mdcollab-api)
#   - cloudflare_r2_bucket       (mdcollab-docs-personal)
#   - cloudflare_hyperdrive_config (→ Neon connection string)
