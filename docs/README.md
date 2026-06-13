# docs 索引

mdcollab のドキュメント一覧。プロジェクト概要は [../README.md](../README.md)、残タスクは [GitHub issues](https://github.com/plzsave/mdcollab/issues) を参照。

## 運用・セットアップ

| ドキュメント | 内容 |
|---|---|
| [local-dev.md](local-dev.md) | ローカル実起動（docker-compose で Postgres + S3互換、`DEV_AUTH` の dev ログイン） |
| [google-oauth-setup.md](google-oauth-setup.md) | 本物の Google OIDC ログインを試すための OAuth クライアント設定 |
| [cloudflare-deploy.md](cloudflare-deploy.md) | Cloudflare（Workers + Hyperdrive→Neon + R2）への本番デプロイ手順 |
| [custom-domain-waf-ratelimit.md](custom-domain-waf-ratelimit.md) | 独自ドメイン移行 + WAF レート制限（ゾーン単位）の設定 |
| [../infra/envs/mdcollab-cf-personal/IMPORT.md](../infra/envs/mdcollab-cf-personal/IMPORT.md) | Terraform/OpenTofu で R2/Hyperdrive を import 管理する手順 |

## 設計

| ドキュメント | 内容 |
|---|---|
| [ai-review-agent.md](ai-review-agent.md) | AI レビューの tool use エージェント化（A〜D + search_docs 全文検索）の設計と実装メモ。実装済み |

## アーカイブ

| ドキュメント | 内容 |
|---|---|
| [archive/TODO.md](archive/TODO.md) | 脱 GAS 移行の残タスク台帳。フェーズ1〜3 + AI エージェント化まで完了し役目を終えた記録（残タスクは issue へ移行） |
