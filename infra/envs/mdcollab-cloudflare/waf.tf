# WAF レート制限（ゾーン phase=http_ratelimit）。/api/auth/* を IP 単位で厳密制限する。
#   - ゾーン本体は import しない。NS 委任はレジストラ側の一度きりの作業のため、
#     zone_id を変数で参照するだけにする（手順書 docs/custom-domain-waf-ratelimit.md §4）。
#   - var.zone_id が空の間は count=0 で不作成。ドメイン確定前でも plan は No changes を保つ。
#
# 反映: export TF_VAR_zone_id='<ゾーンID>' を設定して tofu apply。
#
# スキーマ注意: cloudflare provider は v5 系で rules がブロック→属性リスト(rules=[{...}])に
# 変わった。apply 前に導入済み provider(~> 5.19) の registry で cloudflare_ruleset の
# rate limit フィールド名(requests_per_period / period / mitigation_timeout / characteristics)を
# 確認すること（バージョン・フィールド名はレジストリから引く）。
resource "cloudflare_ruleset" "auth_ratelimit" {
  count = var.zone_id == "" ? 0 : 1

  zone_id = var.zone_id
  name    = "mdcollab auth rate limiting"
  kind    = "zone"
  phase   = "http_ratelimit"

  # 無料プランの制約: period(カウント窓)は 10 秒固定、mitigation_timeout も 10 秒のみ。
  # 30req/60s と同じ平均レート(0.5req/秒)を 5req/10s で表現する。
  # Pro 以上なら period=60 / mitigation_timeout=60 等に引き上げ可。
  rules = [{
    action      = "block"
    description = "auth endpoints: 5 req / 10s per IP (free-plan window)"
    enabled     = true
    expression  = "starts_with(http.request.uri.path, \"/api/auth/\")"
    ratelimit = {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = 10
      requests_per_period = 5
      mitigation_timeout  = 10
    }

    # 任意: AI レビュー保護（コスト保護）を足すなら rules 配列に下記を追記する。
    # 無料プランは Rate limiting rules が 1 本のみなので、その場合は片方に絞ること。
    #
    # }, {
    #   action      = "block"
    #   description = "AI review: 20 req / 60s per IP"
    #   enabled     = true
    #   expression  = "http.request.uri.path contains \"/review\""
    #   ratelimit = {
    #     characteristics     = ["ip.src", "cf.colo.id"]
    #     period              = 60
    #     requests_per_period = 20
    #     mitigation_timeout  = 60
    #   }
  }]
}
