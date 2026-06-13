# Hyperdrive 設定（→ Postgres, 例: Neon）。手動作成済みを import する。
#   host/database/user/port は variables.tf 経由（個人値はコミットしない）
#   caching は read-after-write のため無効化済み（disabled=true）
# import: tofu import cloudflare_hyperdrive_config.neon '<account_id>/<hyperdrive_id>'
resource "cloudflare_hyperdrive_config" "neon" {
  account_id = var.account_id
  name       = var.hyperdrive_name

  origin = {
    scheme   = "postgresql" # 実態に合わせる（Hyperdrive 側の保存値）
    database = var.neon_database
    host     = var.neon_host
    port     = var.neon_port
    user     = var.neon_user
    password = var.neon_password # 読み戻し不可。TF_VAR_neon_password / tfvars で指定。
  }

  caching = {
    disabled = true
  }

  origin_connection_limit = 20

  # password は Cloudflare API が読み戻せず毎回 diff になる。さらに provider が
  # modified_on を computed 扱いにしないバグがあり、変更を伴う apply が
  # "inconsistent result after apply" で失敗する。実害のない差分なので Terraform 側で
  # 追跡対象から外し、no-op（No changes）に保つ。mtls も {}→null の正規化差分を抑制。
  lifecycle {
    ignore_changes = [origin.password, mtls]
  }
}
