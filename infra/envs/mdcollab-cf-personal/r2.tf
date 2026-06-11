# R2 バケット（MD 本体ストア）。手動作成済みを import する。
#   実態: name=mdcollab-docs-personal / location=APAC / Standard / jurisdiction=default
# import: tofu import cloudflare_r2_bucket.docs '<account_id>/<bucket>/<jurisdiction>'
resource "cloudflare_r2_bucket" "docs" {
  account_id    = var.account_id
  name          = "mdcollab-docs-personal"
  location      = "apac"
  storage_class = "Standard"
  jurisdiction  = "default"
}
