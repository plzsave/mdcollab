# GitHub Issue 同期 API 仕様（ドラフト）

mdcollab ドキュメントと GitHub Issue を結びつける API の仕様。Phase 1（作成・本文同期）を対象とする。

## エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/documents/:id/issue` | ドキュメントから Issue を作成（または更新） |
| GET | `/api/documents/:id/issue` | 紐づく Issue の状態を取得 |
| DELETE | `/api/documents/:id/issue` | 紐づけを解除（Issue 自体は消さない） |

## リクエスト / レスポンス

作成リクエストの本文:

```json
{
  "doc_id": "abc123",
  "repo": "owner/name",
  "title": "起票するタイトル",
  "labels": ["docs"]
}
```

成功時のレスポンス:

```json
{
  "documentId": "abc123",
  "issueNumber": 42,
  "url": "https://github.com/owner/name/issues/42",
  "version": "1"
}
```

`version` はドキュメントの版番号で、楽観ロックに使う。リクエストの `doc_id` とレスポンスの
`documentId` は同じ値を指す。

## エラー

| ステータス | code | 意味 |
|---|---|---|
| 400 | BAD_REQUEST | repo 形式が不正、必須項目欠落 |
| 404 | UNAUTHORIZED | PAT 未設定・認証失敗 |
| 409 | CONFLICT | 版が古い（再取得して再送） |

ネットワークやレート制限などの一時失敗は、クライアント側で失敗時は適宜リトライする。

## 補足

- 本文が大きい場合は適切に切り詰める。
- Issue のタイトルは未指定ならドキュメントタイトルを使う。
- repo は `owner/name` 形式のみ許可（既存の review-repo と同じ検証を流用）。
