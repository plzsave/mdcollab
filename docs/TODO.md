# mdcollab 残タスク台帳

GAS 版 `md-collab` 脱 GAS 後継の実装 TODO。出典は API 契約 [`mdcollab-api-inventory.md`](../../mdcollab-api-inventory.md)（45 RPC / 46 エンドポイント）と
移行計画書 [`md-collab-migration-plan.md`](../../md-collab-migration-plan.md)。

- 凡例: `[x]` 実装済み / `[ ]` 未実装
- 現状: **着手順3まで完了**（Statuses/Members/Documents/Threads・Comments/Notifications/通知発火）。ローカル実機で postgres18 + SeaweedFS + 自前セッション + If-Match→409 を確認済み。
- 実装済み API: state / folders(GET・POST・文書一覧) / documents(全10) / statuses(GET・PUT) / members(CRUD) / **threads・comments(7)** / **notifications(3)** ＋認証一式。
- テスト: pglite + メモリストアで結合テスト 48 本。`bun run test`。

最終更新: 2026-06-09

---

## A. API エンドポイント（残 41 / 46）

### 0. App / Setup
- [x] `GET /api/state`（getAppState）※ `aiSettings` 束ね込みは未対応 → D 参照
- [ ] `POST /api/setup`（setupDb・初回ストレージ/DB 初期化、owner）

### 1. Folders
- [x] `GET /api/folders`（getFolders）
- [x] `POST /api/folders`（createFolder）
- [ ] `POST /api/folders/link`（linkFolder・**Drive 固有**。方針(A)では廃止/再設計、(B)で維持）
- [ ] `PATCH /api/folders/:id`（renameFolder）
- [ ] `DELETE /api/folders/:id`（deleteFolder）

### 2. Documents
- [x] `GET /api/documents/:id`（getDocument）
- [x] `PUT /api/documents/:id`（updateDocument・If-Match→409）
- [x] `GET /api/folders/:folderId/documents`（getDocumentList・本文なしの軽量メタ一覧）
- [x] `GET /api/documents/:id?include=threads,revision`（getDocumentBundle・往復削減）
- [x] `POST /api/documents`（createDocument・folderId 検証あり）
- [x] `POST /api/documents/import`（importDocuments・複数ファイル、上限 MAX_IMPORT_FILES=50）
- [x] `DELETE /api/documents/:id`（deleteDocument・子レコード＋本体ストアも掃除）
- [x] `PATCH /api/documents/:id`（status / archived / assignee / title を **1 本に統合**）

### 3. Statuses
- [x] `GET /api/statuses`（getStatuses）
- [x] `PUT /api/statuses`（saveStatuses・一括置換、owner）

### 4. Threads / Comments
- [x] `GET /api/documents/:id/threads`（getThreadsForDocument・非削除コメント同梱）
- [x] `POST /api/documents/:id/threads`（createThread＋mention 通知発火）
- [x] `POST /api/threads/:threadId/comments`（addReply＋reply/mention 通知発火）
- [x] `PATCH /api/comments/:commentId`（editComment・著者のみ）
- [x] `DELETE /api/comments/:commentId`（論理削除・著者のみ）
- [x] `POST /api/threads/:threadId/resolve`（＋resolve 通知発火）
- [x] `POST /api/threads/:threadId/reopen`

### 5. Members
- [x] `GET /api/members`（getMembers）
- [x] `POST /api/members`（addMember、owner）
- [x] `PATCH /api/members/:email`（updateMember、owner・role 変更も。最後の owner 降格は拒否）
- [x] `DELETE /api/members/:email`（removeMember、owner・最後の owner 削除は拒否）

### 6. Notifications
- [x] `GET /api/notifications`（本人宛・新しい順）
- [x] `POST /api/notifications/:id/read`（本人宛のみ・他人のは 404）
- [x] `POST /api/notifications/read-all`

### 7. AI Settings / Secrets
- [ ] `GET /api/ai/settings`（**キー平文を返さない**・has-key 真偽のみ）
- [ ] `PUT /api/ai/settings`（キー暗号化保存・返却は非平文）
- [ ] `DELETE /api/ai/keys/:provider`
- [ ] `PUT /api/ai/github/pat`（PAT 暗号化保存）
- [ ] `DELETE /api/ai/github/pat?scope=`
- [ ] `PUT /api/ai/github/repo`
- [ ] `GET /api/ai/models?provider=`（プロバイダ /models 中継）

### 8. AI Review / Revision
- [ ] `POST /api/documents/:id/review`（**SSE 候補**）
- [ ] `POST /api/documents/:id/review-repo`（GitHub リポジトリ文脈・**SSE 候補**）
- [ ] `GET /api/documents/:id/reviews`（保存済み一覧）
- [ ] `POST /api/documents/:id/revision`（pending ドラフト・doc×user で1件・**SSE 候補**）
- [ ] `DELETE /api/documents/:id/revision`（discardPendingRevision）

---

## B. 横断機能（API と並走）
- [ ] AI キー / GitHub PAT の**暗号化保存**（§6.5）— 平文返却しない不変条件の実体
- [x] 通知の**副作用発火**（mention / reply / resolve）— `src/notify.ts` に集約。メンバーのみ通知・actor 除外・mention と reply は二重にしない
- [ ] AI レビューの **SSE ストリーミング**（Workers の CPU 制約 vs Lambda 15分の差を吸収・§8）
- [ ] **`DriveStorage` 実装**（`src/storage/drive.ts` は現状 stub。方針(B)ハイブリッド用）
- [ ] **AI プロバイダ呼び出し層**（Claude / OpenAI 等のクライアント）
- [ ] `getAppState` の完成（`aiSettings` 等の束ね込み漏れを解消）

---

## C. ランタイム / インフラ / CI
- [ ] **Cloudflare アダプタの実起動確認**（現状ローカル Node のみ検証済み・Hyperdrive 経由 Neon）
- [ ] **Lambda アダプタ**（`hono/aws-lambda` で `createApp` を包む）— 未作成
- [ ] **Terraform 実リソース化**（`infra/envs/mdcollab-{cf-personal,aws-workplace,gcp}` は骨組みのみ）
- [ ] **CI/CD 実配線**（`scripts/deploy-*.sh` / GitHub Actions は骨組み・職場 CodePipeline 未着手）
- [ ] **データ移行スクリプト**（GAS / Sheets / Drive → 新スキーマ＋S3 本体）

---

## D. フロントエンド（現状ゼロ）
- [ ] **SPA 一式**（`doGet` の HTML 置換）
  - [ ] markdown エディタ画面（表示・編集・If-Match→409 体験）
  - [ ] コメントスレッド UI
  - [ ] ステータス / 担当ボード
  - [ ] AI レビュー画面（ストリーミング表示）
  - [ ] 通知 UI
- [ ] 静的配信（Workers Assets / CloudFront+S3）

---

## E. 品質
- [x] テスト基盤（pglite + メモリストア + 署名クッキーのハーネス・`test/helpers/harness.ts`）
- [~] テスト拡充（state/folders/documents/statuses/members は済。残りルートは実装と並走で追加）
- [~] 認可マトリクス（owner / member は statuses/members で検証済。著者・本人宛は未）
- [ ] エラー形式・入力バリデーションの統一

---

## 着手順（方針: バックエンド API を完成させてから区切り、その後フロントへ）

決定（2026-06-10）: **バックエンド完成で一旦区切ってからフロント着手**。フロントは GAS 版の素 HTML を
踏襲せず**フレームワークに乗せる別フェーズ**として開始する（技術選定はそのフェーズ冒頭で行う）。

### フェーズ1: バックエンド API 完成（← いまここ）
1. ✅ **Statuses**（2）→ **Members**（4）
2. ✅ **Documents 残り**（list / create / delete / PATCH 統合 / bundle / import）
3. ⬜ **Threads / Comments**（7）＋ **Notifications**（3）＋通知発火（B）
4. ⬜ **AI Settings**（7）＋暗号化保存（B）→ **AI Review**（5）＋ SSE（B）
5. ⬜ **バックエンド小物**: `POST /api/setup` ／ folders の rename・delete・link 方針確定（A/B）
   → ここで **API がパリティ到達＝区切り**

### フェーズ2: インフラ / 移行（フロントと並行可）
6. ⬜ **データ移行スクリプト**（C）／**Cloudflare 実起動 → Terraform → CI**（C）

### フェーズ3: フロントエンド（フレームワーク・別フェーズ）
7. ⬜ 技術選定（SPA フレームワーク等。決めたら導入パッケージ同梱の `skills/SKILL.md` を確認）
8. ⬜ GAS 版パリティの全画面（D）: 文書一覧/フォルダ・エディタ(409体験)・コメントスレッド・
   ステータスボード・AI レビュー/改稿・通知・メンバー管理・取込/出力
