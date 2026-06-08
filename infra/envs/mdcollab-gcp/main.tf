# 職場・次点: GCP（Cloud Run + GCS + Cloud SQL Postgres）
# state backend: GCS。(B)Drive 温存ならこの env が有利（§4.1）。

terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
      # version は terraform init で解決
    }
  }

  backend "gcs" {
    bucket = "mdcollab-tfstate-gcp"
    prefix = "gcp/terraform.tfstate"
  }
}

provider "google" {
  # project / region は変数 or 環境変数。認証は Workload Identity Federation 想定
}

# TODO(Phase 0):
#   - google_cloud_run_v2_service   mdcollab-api
#   - google_storage_bucket         mdcollab-docs-gcp
#   - google_sql_database_instance  (Postgres)
