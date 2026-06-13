variable "account_id" {
  description = "Cloudflare アカウント ID"
  type        = string
  default     = "4d9f47fbb96473f1fb10e509ace25cd7"
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
