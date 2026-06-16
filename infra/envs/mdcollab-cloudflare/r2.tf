# R2 バケット（MD 本体ストア）。手動作成済みを import する。
#   name/location は variables.tf 経由 / Standard / jurisdiction=default
# import: tofu import cloudflare_r2_bucket.docs '<account_id>/<bucket>/<jurisdiction>'
resource "cloudflare_r2_bucket" "docs" {
  account_id    = var.account_id
  name          = var.r2_bucket_name
  location      = var.r2_location
  storage_class = "Standard"
  jurisdiction  = "default"
}
