# Hyperdrive 設定（→ Neon, Singapore）。手動作成済みを import する。
#   id=b682f4dcc5944f72995071cb3353f975 / name=mdcollab-neon
#   caching は read-after-write のため無効化済み（disabled=true）
# import: tofu import cloudflare_hyperdrive_config.neon '<account_id>/<hyperdrive_id>'
resource "cloudflare_hyperdrive_config" "neon" {
  account_id = var.account_id
  name       = "mdcollab-neon"

  origin = {
    scheme   = "postgresql" # 実態に合わせる（Hyperdrive 側の保存値）
    database = "neondb"
    host     = "ep-lingering-dust-ao4eeoel-pooler.c-2.ap-southeast-1.aws.neon.tech"
    port     = 5432
    user     = "neondb_owner"
    password = var.neon_password # 読み戻し不可。TF_VAR_neon_password / tfvars で指定。
  }

  caching = {
    disabled = true
  }

  origin_connection_limit = 20
}
