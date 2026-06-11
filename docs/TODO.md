# mdcollab 残タスク台帳

GAS 版 `md-collab` 脱 GAS 後継の実装 TODO。出典は API 契約 [`mdcollab-api-inventory.md`](../../mdcollab-api-inventory.md)（45 RPC / 46 エンドポイント）と
移行計画書 [`md-collab-migration-plan.md`](../../md-collab-migration-plan.md)。

- 凡例: `[x]` 実装済み / `[ ]` 未実装
- 現状: **フェーズ1（バックエンド API）完了＝パリティ到達**。方針A(全移行)確定、linkFolder のみ保留（DriveStorage と同時期）。
- 実装済み API: setup / state / folders(全: list/CRUD/文書一覧) / documents(全10) / statuses / members / threads・comments(7) / notifications(3) / ai settings・secrets(7) / ai review・revision(5) ＋認証一式。
- 横断: 通知発火 / 暗号化保存(AES-GCM) / AI プロバイダ層(anthropic・openai) / SSE ストリーミング。
- テスト: pglite + メモリストア + fake LLM で結合テスト 66 本。`bun run test`。
- 次フェーズ: 2(**インフラ=Cloudflare 優先**・データ移行は不要) ／ 3(フロント・フレームワーク)。

最終更新: 2026-06-09

---

## A. API エンドポイント（残 41 / 46）

### 0. App / Setup
- [x] `GET /api/state`（getAppState）※ `aiSettings` 束ね込みは未対応 → D 参照
- [x] `POST /api/setup`（方針A: 初回 members 空なら本人を owner 化＋既定ステータス投入・冪等）

### 1. Folders
- [x] `GET /api/folders`（getFolders）
- [x] `POST /api/folders`（createFolder）
- [~] `POST /api/folders/link`（linkFolder・**Drive 固有**。方針A=全移行のため**保留**→DriveStorage と同時期）
- [x] `PATCH /api/folders/:id`（renameFolder）
- [x] `DELETE /api/folders/:id`（deleteFolder・中身があれば 409＝文書孤児化防止）

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
- [x] `GET /api/ai/settings`（**キー平文を返さない**・has-key 真偽/PATスコープのみ）
- [x] `PUT /api/ai/settings`（provider/model + キー暗号化保存・返却は非平文）
- [x] `DELETE /api/ai/keys/:provider`
- [x] `PUT /api/ai/github/pat`（PAT 暗号化保存）
- [x] `DELETE /api/ai/github/pat?scope=`
- [x] `PUT /api/ai/github/repo`
- [x] `GET /api/ai/models?provider=`（プロバイダ /models 中継）

### 8. AI Review / Revision
- [x] `POST /api/documents/:id/review`（SSE 対応: `?stream=1`）
- [x] `POST /api/documents/:id/review-repo`（repo 参照をプロンプトに含む。リポジトリ本体取得は follow-up）
- [x] `GET /api/documents/:id/reviews`（保存済み一覧）
- [x] `POST /api/documents/:id/revision`（pending ドラフト・doc×user で1件・upsert）
- [x] `DELETE /api/documents/:id/revision`（discardPendingRevision）

---

## B. 横断機能（API と並走）
- [x] AI キー / GitHub PAT の**暗号化保存**（§6.5）— `src/crypto.ts`（Web Crypto AES-GCM）。平文返却しない不変条件をテストで担保
- [x] 通知の**副作用発火**（mention / reply / resolve）— `src/notify.ts` に集約。メンバーのみ通知・actor 除外・mention と reply は二重にしない
- [x] AI レビューの **SSE ストリーミング**（`hono/streaming` の `streamSSE`・`?stream=1`）
- [x] **AI プロバイダ呼び出し層**（`src/llm/`・anthropic/openai の実 HTTP。Deps に注入＝テストは fake）
- [ ] **`DriveStorage` 実装**（`src/storage/drive.ts` は現状 stub。方針(B)ハイブリッド用）
- [ ] GitHub リポジトリ本体取得（review-repo の深掘り・PAT 使用）
- [ ] `getAppState` の完成（`aiSettings` 等の束ね込み漏れを解消）

---

## C. ランタイム / インフラ / CI
**Cloudflare 優先**（AWS は後回し）。**データ移行は不要**（本番は空スタート）。
方針: **軽い入り方**（wrangler 手動デプロイで本番起動）→ 後で `terraform import` で一括管理へ。
- [x] **Cloudflare 実起動完了**（2026-06-10）。`https://mdcollab-api.yskab-dev.workers.dev`。
  Workers + Hyperdrive→Neon + R2 + 自前 Google OAuth + setup(owner化) + 文書 R2 往復まで本番疎通確認済み。
  手順書 [`docs/cloudflare-deploy.md`](cloudflare-deploy.md)。secrets は `wrangler secret`（SESSION/ENCRYPTION/S3×2/GOOGLE×2）。
- [ ] **Terraform(cf-personal) 実リソース化**（手動で作った R2/Hyperdrive を import → Workers も IaC 管理へ・後回し可）
- [ ] **CI 実配線（GitHub Actions）**（`scripts/deploy-cf.sh` を呼ぶだけ・secrets 注入）
- [ ] （後回し）**Lambda/Fargate アダプタ** ＋ **Terraform(aws-workplace)** ＋ **CodePipeline**
- [x] ~~データ移行スクリプト~~ → **不要**（本番空スタート・履歴引き継ぎなし）

---

## D. フロントエンド（フェーズ3・進行中）
スタック確定: **React 19 + Vite + TanStack Router(SPA, file-based) + TanStack Query + Tailwind v4**（`web/`）。
データ層は Query 主役・Router はナビゲーション専念。認証は `/api/state` の 200/401/403 でゲート。
- [x] 足場一式（vite/tsconfig/router/query/api クライアント・型）＋ ビルド通過（コード分割確認）
- [x] 認証ゲート（未ログイン→Google・非メンバー→初回 setup）＋ アプリシェル（サイドバー: フォルダ）
- [x] フォルダ内 文書一覧 → 文書表示
- [x] **markdown エディタ**（編集/分割/プレビュー・保存・If-Match→409 衝突UI[上書き/最新読込]）。marked+dompurify でサニタイズ描画
- [x] コメントスレッド UI（選択範囲アンカーで新規スレッド・返信・解決/再開・編集/削除・@メンション選択。エディタ右パネル）
- [x] AI レビュー画面（SSE ストリーミング表示・改稿生成→エディタ反映・過去レビュー一覧。エディタ右パネル）
- [x] AI 設定画面（プロバイダ/モデル/APIキー暗号化保存・モデル候補取得・GitHub repo。`/settings/ai`）
- [x] ステータス / 担当ボード（フォルダ画面に一覧⇄ボード切替・ステータス列・カードのセレクトで status/担当変更・アーカイブ。PATCH /api/documents/:id）
- [x] 通知 UI（`/notifications`・一覧/既読/全既読・文書つきは開いて既読化・サイドバー&ヘッダのバッジ）
- [x] メンバー管理（`/members`・owner は追加/role変更/削除・member は閲覧のみ・最後の owner 保護はサーバ側）
- [ ] フォルダ・文書の作成 / 取込 / 出力
- [ ] 静的配信を本番 Worker に結線（`[assets]` + SPA フォールバック・`/api/*` は Worker 優先）

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

### フェーズ1: バックエンド API 完成
1. ✅ **Statuses**（2）→ **Members**（4）
2. ✅ **Documents 残り**（list / create / delete / PATCH 統合 / bundle / import）
3. ✅ **Threads / Comments**（7）＋ **Notifications**（3）＋通知発火（B）
4. ✅ **AI Settings**（7）＋暗号化保存（B）→ **AI Review**（5）＋ SSE（B）
5. ✅ **バックエンド小物**: `POST /api/setup` ／ folders rename・delete（方針A確定: 全移行。**linkFolder は保留**）
   → **API パリティ到達＝フェーズ1 完了。区切り。**

### フェーズ2: インフラ（Cloudflare 優先・フロントと並行可）
決定（2026-06-10）: **データ移行は不要**（本番は空スタート・MD は必要時に手動追加・履歴引き継ぎ不要）。
**インフラは Cloudflare を先に通す**（AWS は後回し）。
6. ⬜ **Cloudflare 実起動**（Workers + Hyperdrive→Neon + R2）→ **Terraform(cf-personal)** → **CI(GitHub Actions)**
7. ⬜ （後回し）AWS 一式（RDS/Lambda or Fargate・Terraform aws-workplace・CodePipeline）

### フェーズ3: フロントエンド（フレームワーク・別フェーズ）
7. ⬜ 技術選定（SPA フレームワーク等。決めたら導入パッケージ同梱の `skills/SKILL.md` を確認）
8. ⬜ GAS 版パリティの全画面（D）: 文書一覧/フォルダ・エディタ(409体験)・コメントスレッド・
   ステータスボード・AI レビュー/改稿・通知・メンバー管理・取込/出力
