# mdcollab API インベントリ（旧 GAS RPC → REST マッピング）

> 📦 **アーカイブ（2026-07-13）。** この契約に基づく実装は完了（[`TODO.md`](./TODO.md) 参照）。経緯の記録として残置（以後は編集しない）。

> 由来: 旧 `md-collab/src/main.ts` の export（= `google.script.run` 公開面）と `src/Code.ts` のシグネチャから機械抽出。**45 RPC 関数 ＋ `doGet`（HTML エントリ）**。
> 位置づけ: 移行計画書（`md-collab-migration-plan.md`）§9 の `api.xxx()` 層とバックエンド双方の**契約**。Phase 1（読み取り）以降はこの表をドリブンに実装する。

## 共通規約

- **認証**: 旧実装は全 RPC が `requireMember()` を通る（メンバー制）。新 API は**全エンドポイントに OIDC セッション＋members 認可ミドルウェア**を噛ませる（§7）。表の「認可」列は最小要件（`member` / `owner`）。
- **エラー**: 旧は `throw new Error(...)`／競合は `CONFLICT`。新は HTTP ステータス（`400/401/403/404/409/422/5xx`）＋ `{ error: { code, message } }`。
- **競合検知**: `updateDocument` の `expectedLastUpdated` → **`If-Match: <version>`**。サーバは条件付き更新で 0 行なら **`409 CONFLICT`**（§6.3）。`lastUpdated`(epoch ms) は新スキーマの `version`(int) に置換。
- **ID**: 旧 `fileId`（Drive fileId）は新 `documentId`（新規採番）。本体の所在は `DocumentStore`（(A)`storage_key` / (B)`drive_file_id`）で隠蔽（§6.2）。
- **AIキー**: 書き込み系（`saveAiSettings`/`saveGithubPat`）は受領のみ。**平文を返さない不変条件を維持**（§6.5）。
- **ストリーミング**: AI 系（`reviewDocument`/`reviewDocumentRepo`/`proposeRevision`）は **SSE 候補**（§8）。

---

## 0. App / Setup（2）

| 旧 GAS 関数 | 新エンドポイント | 旧シグネチャ | 認可 | 備考 |
|---|---|---|---|---|
| `getAppState()` | `GET /api/state` | → `AppState` | member | 起動時ブートストラップ束（members/folders/statuses/notifications/aiSettings/currentUser 等）。往復削減の要 |
| `setupDb(baseFolderId)` | `POST /api/setup` | `(baseFolderId)` → `{ok:true}` | owner | 旧は Drive ベースフォルダ＋Sheets DB 初期化。**(A)では Drive 概念が消える**ため「ストレージ/DB 初期化」に読み替え。初回のみ |

## 1. Folders（5）

| 旧 GAS 関数 | 新エンドポイント | 旧シグネチャ | 認可 | 備考 |
|---|---|---|---|---|
| `getFolders()` | `GET /api/folders` | → `Folder[]` | member | |
| `createFolder(name)` | `POST /api/folders` | `(name)` → `Folder` | member | |
| `linkFolder(driveFolderId, name?)` | `POST /api/folders/link` | `(driveFolderId, name?)` → `Folder` | member | **Drive 固有**。(A)フル移行では廃止 or 「外部取り込み」へ再設計／(B)ハイブリッドでは維持（§4.2） |
| `renameFolder(folderId, newName)` | `PATCH /api/folders/:id` | `(folderId, newName)` → `void` | member | body `{name}` |
| `deleteFolder(folderId)` | `DELETE /api/folders/:id` | `(folderId)` → `void` | member | |

## 2. Documents（10）

| 旧 GAS 関数 | 新エンドポイント | 旧シグネチャ | 認可 | 備考 |
|---|---|---|---|---|
| `getDocumentList(folderId)` | `GET /api/folders/:folderId/documents` | `(folderId)` → `MdDocument[]` | member | 旧は Drive 走査。新はメタ DB から引き高速化（§6.2） |
| `getDocument(fileId)` | `GET /api/documents/:id` | `(fileId)` → `{content, lastUpdated}` | member | |
| `getDocumentBundle(fileId)` | `GET /api/documents/:id?include=threads,revision` | `(fileId)` → `{content, lastUpdated, threads, pendingRevision}` | member | **往復削減バンドル**。本文＋スレッド＋pending を1発で |
| `createDocument(folderId, title)` | `POST /api/documents` | `(folderId, title)` → `MdDocument` | member | body `{folderId, title}` |
| `importDocuments(folderId, files[])` | `POST /api/documents/import` | `(folderId, [{name,content}])` → `[{name, ok, docName?, id?, error?}]` | member | 上限 `MAX_IMPORT_FILES` を踏襲 |
| `updateDocument(fileId, content, expectedLastUpdated?)` | `PUT /api/documents/:id` | `(fileId, content, expectedLastUpdated?)` → `number(newLastUpdated)` | member | **`If-Match: version`** → 条件付き更新／`409 CONFLICT`。返り値は新 version（§6.3） |
| `deleteDocument(fileId)` | `DELETE /api/documents/:id` | `(fileId)` → `void` | member | |
| `setDocumentStatus(fileId, statusId)` | `PATCH /api/documents/:id` | `(fileId, statusId)` → `void` | member | ↓3つは **1エンドポイントに統合可**（partial body `{statusId?, archived?, assignee?}`） |
| `setDocumentArchived(fileId, archived)` | `PATCH /api/documents/:id` | `(fileId, archived)` → `void` | member | 統合候補 |
| `setDocumentAssignee(fileId, assignee)` | `PATCH /api/documents/:id` | `(fileId, assignee)` → `void` | member | 統合候補 |

## 3. Statuses（2）

| 旧 GAS 関数 | 新エンドポイント | 旧シグネチャ | 認可 | 備考 |
|---|---|---|---|---|
| `getStatuses()` | `GET /api/statuses` | → `DocStatus[]` | member | |
| `saveStatuses(statuses[])` | `PUT /api/statuses` | `(DocStatus[])` → `DocStatus[]` | owner | 一括置換（order 含む） |

## 4. Threads / Comments（7）

| 旧 GAS 関数 | 新エンドポイント | 旧シグネチャ | 認可 | 備考 |
|---|---|---|---|---|
| `getThreadsForDocument(documentId)` | `GET /api/documents/:id/threads` | `(documentId)` → `CommentThread[]` | member | |
| `createThread(documentId, anchorText, anchorBefore, anchorAfter, firstComment, mentions[])` | `POST /api/documents/:id/threads` | 上記 → `CommentThread` | member | アンカー＋初コメントを同時生成。mention 通知発火 |
| `addReply(threadId, content, mentions[])` | `POST /api/threads/:threadId/comments` | `(threadId, content, mentions[])` → `Comment` | member | reply 通知発火 |
| `editComment(commentId, newContent)` | `PATCH /api/comments/:commentId` | `(commentId, newContent)` → `void` | member（著者） | |
| `deleteComment(commentId)` | `DELETE /api/comments/:commentId` | `(commentId)` → `void` | member（著者） | 旧は論理削除（`deleted`） |
| `resolveThread(threadId)` | `POST /api/threads/:threadId/resolve` | `(threadId)` → `void` | member | resolve 通知発火 |
| `reopenThread(threadId)` | `POST /api/threads/:threadId/reopen` | `(threadId)` → `void` | member | |

## 5. Members（4）

| 旧 GAS 関数 | 新エンドポイント | 旧シグネチャ | 認可 | 備考 |
|---|---|---|---|---|
| `getMembers()` | `GET /api/members` | → `Member[]` | member | |
| `addMember(email, displayName)` | `POST /api/members` | `(email, displayName)` → `Member` | owner | |
| `updateMember(email, displayName)` | `PATCH /api/members/:email` | `(email, displayName)` → `void` | owner | |
| `removeMember(email)` | `DELETE /api/members/:email` | `(email)` → `void` | owner | |

## 6. Notifications（3）

| 旧 GAS 関数 | 新エンドポイント | 旧シグネチャ | 認可 | 備考 |
|---|---|---|---|---|
| `getNotifications()` | `GET /api/notifications` | → `Notification[]` | member（本人宛） | |
| `markNotificationRead(notifId)` | `POST /api/notifications/:id/read` | `(notifId)` → `void` | member（本人宛） | |
| `markAllNotificationsRead()` | `POST /api/notifications/read-all` | → `void` | member（本人宛） | |

## 7. AI Settings / Secrets（7）

| 旧 GAS 関数 | 新エンドポイント | 旧シグネチャ | 認可 | 備考 |
|---|---|---|---|---|
| `getAiSettings()` | `GET /api/ai/settings` | → `AiSettings` | member（本人） | **キー平文は含めない**（has-key 真偽のみ） |
| `saveAiSettings(provider, apiKey, model)` | `PUT /api/ai/settings` | `(provider, apiKey, model)` → `AiSettings` | member（本人） | キーは暗号化保存（§6.5）。返却は非平文 |
| `clearAiKey(provider)` | `DELETE /api/ai/keys/:provider` | `(provider)` → `AiSettings` | member（本人） | |
| `saveGithubPat(scope, pat)` | `PUT /api/ai/github/pat` | `(scope, pat)` → `AiSettings` | member（本人） | PAT も暗号化保存 |
| `clearGithubPat(scope)` | `DELETE /api/ai/github/pat?scope=` | `(scope)` → `AiSettings` | member（本人） | |
| `saveGithubRepo(repo)` | `PUT /api/ai/github/repo` | `(repo)` → `AiSettings` | member（本人） | |
| `listAiModels(provider)` | `GET /api/ai/models?provider=` | `(provider)` → `string[]` | member（本人） | プロバイダの `/models` を中継 |

## 8. AI Review / Revision（5）

| 旧 GAS 関数 | 新エンドポイント | 旧シグネチャ | 認可 | 備考 |
|---|---|---|---|---|
| `reviewDocument(fileId, instructions)` | `POST /api/documents/:id/review` | `(fileId, instructions)` → `{review, provider, model, createdAt, createdByName}` | member | **SSE 候補**。Workers は CPU 制約注意／Lambda は 15分で素直（§4.1/§8） |
| `reviewDocumentRepo(fileId, instructions, repoOverride)` | `POST /api/documents/:id/review-repo` | `(fileId, instructions, repoOverride)` → `{..., repo}` | member | GitHub リポジトリ文脈付きレビュー。**SSE 候補** |
| `getReviews(documentId)` | `GET /api/documents/:id/reviews` | `(documentId)` → `SavedReview[]` | member | 保存済みレビュー一覧 |
| `proposeRevision(fileId, reviewContent, instructions)` | `POST /api/documents/:id/revision` | `(fileId, reviewContent, instructions)` → `{revised, provider, model, baseLastUpdated, createdAt}` | member | pending な AI 修正ドラフト生成（doc×user で1件）。**SSE 候補** |
| `discardPendingRevision(documentId)` | `DELETE /api/documents/:id/revision` | `(documentId)` → `void` | member | |

## 9. 非 RPC

| 旧 | 新 | 備考 |
|---|---|---|
| `doGet(e)` → HtmlOutput | 静的配信（Workers Assets / CloudFront+S3） | SPA エントリに置換。RPC ではない |
| `getDocumentName(fileId)`（内部） | — | `main.ts` 未 export＝公開面ではない。サーバ内部で利用 |

---

## 設計メモ（実装前の確認事項）

1. **エンドポイント統合**: `setDocumentStatus/Archived/Assignee` の3つは `PATCH /api/documents/:id`（partial body）に集約推奨 → 実エンドポイントは **45 → 約43** に減る。
2. **バンドル維持**: `getDocumentBundle` は往復削減の要。新 API でも `?include=` で本文＋threads＋revision を1発で返す経路を残す。
3. **通知の副作用**: `createThread`/`addReply`/`resolveThread` は mention/reply/resolve 通知を発火（旧 `createXxxNotifications`）。新実装でもトランザクション内 or 後続ジョブで発火（低頻度なので同期で可）。
4. **Drive 固有面**: `linkFolder` と `setupDb(baseFolderId)` が Drive/Sheets 前提。A/B 確定でここの仕様が変わる（§4.2）。`DocumentStore` 抽象で本体側は吸収済みだが、**フォルダ取り込み UX**は要再設計。
5. **認可の粒度**: 表の `owner` は `isOwner()` 相当、`member（本人）`/`member（著者）` は所有者チェック付き。API ミドルウェア＋行レベルスコープで踏襲（§7.3）。
6. **フロント側**: 旧 `src/client/main.ts`（2448行）は `google.script.run` を**インライン散在**で呼ぶ。§9 の `api.xxx()` ラッパを新規に挟み、この表のエンドポイントへ束ねる。
