# docs 索引

mdcollab のドキュメント一覧。プロジェクト概要は [../README.md](../README.md)、残タスクは [GitHub issues](https://github.com/plzsave/mdcollab/issues) を参照。

> ⚠ docs は**参考**であって権威ではない。手順・秘密・設定の**真実はコード/設定**（`wrangler.template.toml`・`infra/**/.envrc`+`terraform.tfvars`・`src/db/schema.ts` 等）。記載と実態がズレたら実ファイル側を正とし、docs を直す。出所の一覧は [`../CLAUDE.md`](../CLAUDE.md)。

## 運用・セットアップ

| ドキュメント | 内容 |
|---|---|
| [local-dev.md](local-dev.md) | ローカル実起動（docker-compose で Postgres + S3互換、`DEV_AUTH` の dev ログイン） |
| [google-oauth-setup.md](google-oauth-setup.md) | 本物の Google OIDC ログインを試すための OAuth クライアント設定 |
| [cloudflare-deploy.md](cloudflare-deploy.md) | Cloudflare（Workers + Hyperdrive(→Postgres) + R2）への本番デプロイ手順 |
| [custom-domain-waf-ratelimit.md](custom-domain-waf-ratelimit.md) | 独自ドメイン移行 + WAF レート制限（ゾーン単位）の設定 |
| [../infra/envs/mdcollab-cloudflare/IMPORT.md](../infra/envs/mdcollab-cloudflare/IMPORT.md) | Terraform/OpenTofu で R2/Hyperdrive を import 管理する手順 |

## 設計

| ドキュメント | 内容 |
|---|---|
| [ai-review-agent.md](ai-review-agent.md) | AI レビューの tool use エージェント化（A〜D + search_docs 全文検索）の設計と実装メモ。実装済み |
| [ai-review-agent-v2.md](ai-review-agent-v2.md) | エージェント拡張の続編設計（② 可観測性 / ⑤ 安全網 / ③ ツール拡張 + G2 web_fetch / ④ 改稿エージェント化）。**実装済み・本番稼働**（#14 完了） |
| [ai-review-comment-threads.md](ai-review-comment-threads.md) | ① 指摘のコメントスレッド化（構造化 finding→アンカー付き AI スレッド）の設計。**実装済み・本番稼働** |

## アーカイブ

| ドキュメント | 内容 |
|---|---|
| [archive/TODO.md](archive/TODO.md) | 脱 GAS 移行の残タスク台帳。フェーズ1〜3 + AI エージェント化まで完了し役目を終えた記録（残タスクは issue へ移行） |
