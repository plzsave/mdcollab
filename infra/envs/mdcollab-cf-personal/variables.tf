variable "account_id" {
  description = "Cloudflare アカウント ID（terraform.tfvars か TF_VAR_account_id で渡す）"
  type        = string
}

variable "r2_bucket_name" {
  description = "MD 本体を置く R2 バケット名"
  type        = string
}

variable "r2_location" {
  description = "R2 バケットのロケーションヒント（apac / wnam / enam / weur / eeur）"
  type        = string
  default     = "apac"
}

# Hyperdrive の origin（Postgres）。host はデプロイ先固有なので変数化（パスワードは別途・読み戻し不可）。
variable "hyperdrive_name" {
  description = "Hyperdrive 設定の名前"
  type        = string
  default     = "mdcollab-neon"
}

variable "neon_host" {
  description = "Hyperdrive origin の Postgres ホスト（例: Neon の pooler ホスト）"
  type        = string
}

variable "neon_database" {
  description = "Postgres データベース名"
  type        = string
  default     = "neondb"
}

variable "neon_user" {
  description = "Postgres ユーザー名"
  type        = string
  default     = "neondb_owner"
}

variable "neon_port" {
  description = "Postgres ポート"
  type        = number
  default     = 5432
}

# Hyperdrive の origin パスワード（Neon の接続パスワード）。
# Cloudflare API はこの値を読み戻せないため、import 後の plan を一致させるには手動で渡す。
# 渡し方: 環境変数 TF_VAR_neon_password=... もしくは gitignore された terraform.tfvars。
variable "neon_password" {
  description = "Neon (Hyperdrive origin) のパスワード。読み戻し不可のため手動指定。"
  type        = string
  sensitive   = true
}

# WAF レート制限を適用する独自ドメインのゾーン ID。
# 空のままなら WAF ルール(waf.tf)は作成されない（count ガード）ので、
# ドメイン確定前でも既存の R2/Hyperdrive 向け plan/apply は壊れない。
# 渡し方: 環境変数 TF_VAR_zone_id=... もしくは gitignore された terraform.tfvars。
variable "zone_id" {
  description = "WAF レート制限を適用する Cloudflare ゾーン ID（未設定なら WAF ルール不作成）"
  type        = string
  default     = ""
}
