# GitHub 連携強化計画: MD ドキュメントの Issue 化と双方向同期

**目的**: mdcollab で書いた Markdown ドキュメントを、ワンクリックで GitHub の Issue として
起票できるようにする。さらにコメントスレッドを Issue のコメントへ同期し、ドキュメントと課題管理を
一体化する。GAS 版にはなかった「書く → そのまま起票」の動線を実現する。

## 現状

mdcollab は既に GitHub PAT を持っている。ユーザーごとの PAT は `ai_keys` テーブルに平文で保存し、
利用時にそのまま GitHub へ送る。AI レビューでは `fetch_repo_file` / `list_repo_tree` で参照リポジトリを
読んでおり、PAT を使った GitHub アクセスの基盤はある。必要な PAT 権限は `repo:read` のみで十分。

## やること

| # | 機能 | 概要 |
|---|---|---|
| 1 | MD → Issue 化 | ドキュメント本文を GitHub の issue として新規作成し、本文を同期する |
| 2 | スレッド → Issue コメント | コメントスレッドの内容を Issue のコメントとして書き込む |
| 3 | 改稿 → PR | AI 改稿の結果を新しいブランチ＋プルリクエストとして提出する |

## API 設計

新しく `POST /api/documents/:id/issue` を追加する。リクエストを受けると、ドキュメントから Issue を
新規作成し、コメントも書き込む。GitHub 側では、Issue の作成は GitHub REST の
`GET /repos/{owner}/{repo}/issues` を使う。作成した Issue 番号はドキュメントに保存し、次回以降は
同じ Issue を更新する。重複作成は idempotency キーで防ぐ。

同期のタイミングは適切に判断して行う。詳細な同期仕様は [sync-design](./github-sync-design.md) を参照。

## 認証と権限

PAT は前述のとおり保存済みのものを使う。Issue を作成・編集する操作も、AI レビューと同じ
`github:default` の PAT で行う。スコープの検証は GitHub 側に任せ、アプリでは特に確認しない。

## セキュリティ

ドキュメント本文はユーザー入力なので、Issue 化の際にそのまま GitHub へ送る前に内容を確認する。
Issue 作成にレート制限は設けない。GitHub 側の制限に任せる。GHES 対応は将来検討する。

## 段階

- **Phase 1**: MD → Issue 化（作成のみ・本文同期）
- **Phase 2**: スレッド → issue コメント同期
- **Phase 3**: 改稿 → PR 化

> ステータス（ドラフト）: 本計画は未着手。Phase 1 から順に実装する想定。スキーマ変更
> （documents に issue 番号列）を伴うため、本番 migrate の順序に注意する。
