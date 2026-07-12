# mdcollab 残タスク台帳（アーカイブ・完了）

> 📦 **この台帳は役目を終えました（2026-06-13 アーカイブ）。** 脱 GAS 移行のフェーズ 1〜3（バックエンド API パリティ → インフラ/CI → フロント）に加え、AI レビューのエージェント化（A〜D）と search_docs 全文検索まで完了し本番稼働中（`md.example.com`）。
> 以降に残った少量のタスクは **GitHub issue へ移行**しました:
> - AWS デプロイ一式 → [#7](https://github.com/plzsave/mdcollab/issues/7)
> - 入力サイズ上限 → [#8](https://github.com/plzsave/mdcollab/issues/8)
> - CSP 導入 → [#9](https://github.com/plzsave/mdcollab/issues/9)
> - esbuild advisory 追従 → [#10](https://github.com/plzsave/mdcollab/issues/10)
>
> 本ファイルは移行の経緯・判断の記録として残置（以後は編集しない）。現状の進捗は GitHub issues を正とする。

GAS 版 `md-collab` 脱 GAS 後継の実装 TODO。出典は API 契約 [`mdcollab-api-inventory.md`](./mdcollab-api-inventory.md)（45 RPC / 46 エンドポイント）と
移行計画書 [`md-collab-migration-plan.md`](./md-collab-migration-plan.md)。

- 凡例: `[x]` 実装済み / `[ ]` 未実装
- 現状: **フェーズ1（バックエンド API）完了＝パリティ到達**。方針A(全移行)確定、linkFolder のみ保留（DriveStorage と同時期）。
- 実装済み API: setup / state / folders(全: list/CRUD/文書一覧) / documents(全10) / statuses / members / threads・comments(7) / notifications(3) / ai settings・secrets(7) / ai review・revision(5) ＋認証一式。
- 横断: 通知発火 / 暗号化保存(AES-GCM) / AI プロバイダ層(anthropic・openai) / SSE ストリーミング。
- テスト: pglite + メモリストア + fake LLM で結合テスト 66 本。`bun run test`。
- 次フェーズ: 2(**インフラ=Cloudflare 優先**・データ移行は不要) ／ 3(フロント・フレームワーク)。

最終更新: 2026-06-12

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
- [x] ~~**`DriveStorage` 実装**~~ → **退役**（方針A=全移行で R2 のみ採用。ハイブリッド(B)前提が消えたため不要・stub は残置可）
- [x] GitHub リポジトリ本体取得（review-repo の深掘り）— `src/github/`（Deps 注入・テストは fake）。PAT(github:default 優先) で説明+README を取得しプロンプトに添える。失敗時は repo 名のみにフォールバック
- [x] `getAppState` の完成 — `/api/state` に `aiSettings` を束ね込み（`src/ai/settings.ts` に共有化・平文キー非含）。フロントは `useAiSettings` の initialData に活用し初回往復を削減

---

## C. ランタイム / インフラ / CI
**Cloudflare 優先**（AWS は後回し）。**データ移行は不要**（本番は空スタート）。
方針: **軽い入り方**（wrangler 手動デプロイで本番起動）→ 後で `terraform import` で一括管理へ。
- [x] **Cloudflare 実起動完了**（2026-06-10）。`https://mdcollab-api.yskab-dev.workers.dev`。
  Workers + Hyperdrive→Postgres + R2 + 自前 Google OAuth + setup(owner化) + 文書 R2 往復まで本番疎通確認済み。
  手順書 [`docs/cloudflare-deploy.md`](../cloudflare-deploy.md)。secrets は `wrangler secret`（SESSION/ENCRYPTION/S3×2/GOOGLE×2）。
- [x] **Terraform(cloudflare) 実リソース化 完了**（2026-06-12・R2/Hyperdrive のみ・Worker は wrangler 継続）。
  OpenTofu で import 済み・`tofu plan` 差分ゼロ（`infra/envs/mdcollab-cloudflare/`・provider 5.19・state ローカル）。
  Hyperdrive は password/mtls を `ignore_changes`。手順 `IMPORT.md`。
- [x] **CI/CD 完了**（GitHub Actions・repo `plzsave/mdcollab` private）。`ci.yml`: check[typecheck+test+webビルド] → main push で deploy-cf（web build→wrangler deploy→smoke）。`CLOUDFLARE_API_TOKEN` 投入済みで全ジョブ緑・自動デプロイ稼働。Terraform/migrate は CI 非対象（手動）。
- [ ] （後回し）**Lambda/Fargate アダプタ** ＋ **Terraform(aws)** ＋ **CodePipeline**
- [x] ~~データ移行スクリプト~~ → **不要**（本番空スタート・履歴引き継ぎなし）

---

## D. フロントエンド（フェーズ3・進行中）
スタック確定: **React 19 + Vite + TanStack Router(SPA, file-based) + TanStack Query + Tailwind v4**（`web/`）。
データ層は Query 主役・Router はナビゲーション専念。認証は `/api/state` の 200/401/403 でゲート。
- [x] 足場一式（vite/tsconfig/router/query/api クライアント・型）＋ ビルド通過（コード分割確認）
- [x] 認証ゲート（未ログイン→Google・非メンバー→初回 setup）＋ アプリシェル（サイドバー: フォルダ）
- [x] フォルダ内 文書一覧 → 文書表示
- [x] **markdown エディタ**（編集/分割/プレビュー・保存・If-Match→409 衝突UI[上書き/最新読込]）。marked+dompurify でサニタイズ描画
- [x] コメントスレッド UI（プレビュー選択でフローティング「コメント」ボタン→新規スレッド・本文ハイライト・ハイライト⇄スレッドのクリックジャンプ・返信・解決/再開・編集/削除・@メンション選択。エディタ右パネル）
- [x] AI レビュー画面（SSE ストリーミング表示・改稿生成→エディタ反映・過去レビュー一覧。エディタ右パネル）
- [x] AI 設定画面（プロバイダ/モデル/APIキー暗号化保存・モデル候補取得・GitHub repo。`/settings/ai`）
- [x] ステータス / 担当ボード（フォルダ画面に一覧⇄ボード切替・ステータス列・カードのセレクトで status/担当変更・アーカイブ。PATCH /api/documents/:id）
- [x] 通知 UI（`/notifications`・一覧/既読/全既読・文書つきは開いて既読化・サイドバー&ヘッダのバッジ）
- [x] メンバー管理（`/members`・owner は追加/role変更/削除・member は閲覧のみ・最後の owner 保護はサーバ側）
- [x] フォルダ・文書の作成 / 取込 / 出力（サイドバーでフォルダ作成・フォルダ画面で改名/削除・新規文書/Markdown取込・エディタで .md エクスポート/削除）
- [x] 静的配信を本番 Worker に結線（`[assets]` directory=web/dist・not_found_handling=single-page-application・run_worker_first=["/api/*","/health"]。`bun run deploy`=build:web→wrangler deploy。本番反映済み）

## F. UX 改善（フィードバック対応）
- [x] 二次ボタンのホバー明確化／ヘッダのユーザー表示を表示名に統一（メールは title）
- [x] メンバー画面で owner が表示名をインライン変更（API は owner 限定なので member の自己変更は別途要検討）
- [x] コメント一覧の既定を「未解決のみ」に（解決済みはトグル）
- [x] 一覧ビューに進捗表示（ステータス別カウント＋色付きバッジ・`lib/statusColor.ts`）
- [x] ダークモード（OS追従＋トグル・`lib/theme.ts`/`ThemeToggle`・@custom-variant・全画面 dark: 付与）
- [x] コメントアンカーの一意化（軽量版・`web/src/lib/highlight.ts`: anchorBefore/After の前後一致でスコアリングし最良の出現を採用。編集追従はしない）
- [x] member 自身の表示名変更（`PATCH /api/members/:email` を「自分 or owner」許可・role 変更は owner 限定。フロントは自分にも「名前変更」表示）
- [x] ダーク UI 改善（primary ボタンを `dark:bg-slate-700` で面より浮かせる／コメント引用 blockquote のダーク可読性）

---

## E. 品質
- [x] テスト基盤（pglite + メモリストア + 署名クッキーのハーネス・`test/helpers/harness.ts`）
- [x] テスト拡充（全ルートに結合テスト・計81本。threads/comments・notifications・ai・reviews も網羅）
- [x] 認可マトリクス（`test/authz.test.ts`: 代表11エンドポイントの未ログイン401/非メンバー403・著者のみ削除403・AI秘密のユーザー間分離）
- [x] エラー形式・入力バリデーションの統一（エラー封筒 `{error:{code,message}}` を 401/403/400/404/409 で検証。`test/validation.test.ts`: 壊れた JSON/必須欠落/空パッチ等で 500 にせず 400 を返すことを代表7ケースで保証）

---

## G. セキュリティレビュー（2026-06-12 実施）
本格レビュー実施。観点別に精査し、安価で効くものは即修正・残りはリスク受容を明記。

**是正済み:**
- [x] OIDC nonce 検証（id_token リプレイ防止）＋ `email_verified` 必須化＋認証失敗を汎用 400 に（詳細非露出）
- [x] `app.onError` 追加（未処理例外はログのみ・client へは `{error:{code:INTERNAL}}`）
- [x] SPA セキュリティヘッダ（`web/public/_headers`: nosniff / X-Frame-Options:DENY / Referrer-Policy / Permissions-Policy）本番反映確認済み
- [x] review-repo の repo を `owner/name` 形式に限定（GitHub URL へのパス混入防止）

**問題なし（確認済み）:** 署名セッション(HS256・alg 固定)・httpOnly/Secure/SameSite=Lax・OAuth state(CSRF)・dev-login 本番無効・members 認可マトリクス・AES-GCM 暗号化(平文非返却)・SQL パラメータ化・ストレージキーは UUID・HTML は DOMPurify・PAT はホスト固定送信。

**リスク受容 / 後回し（要時に対応）:**
- [~] レート制限: `/api/auth/*` に Workers `[[ratelimits]]`(AUTH_LIMITER・IP 30/60s) を導入（cloudflare アダプタ・フェイルオープン）。
  ただし Cloudflare の同バインディングは公式に **permissive/結果整合/コロ単位の best-effort**（正確な計数ではない）で、実機バースト(50〜100)では 429 を返さなかった＝**持続的乱用のコストを上げる程度**。
  **厳密な制限が要る場合は独自ドメイン + WAF レート制限ルール（ゾーン単位・正確）へ。workers.dev では WAF レート制限は使えない。**
  → 採用方針: **2（独自ドメイン+WAF）**。手順書 [`docs/custom-domain-waf-ratelimit.md`](../custom-domain-waf-ratelimit.md)。
  進捗(2026-06-13): 独自ドメイン `md.example.com` へ移行完了（wrangler.toml の `[[routes]] custom_domain` ＋ `workers_dev=false`・BASE_URL/OAuth 切替・ログイン疎通確認済み）。
  WAF レート制限ルールも `tofu apply` 済み（`infra/.../waf.tf`・`cloudflare_ruleset.auth_ratelimit`）。**無料プラン制約**で `period`/`mitigation_timeout` は 10秒固定・1ルールのみのため、実構成は **IP 5req/10s で 10秒 Block**（30req/60s と同平均レート）。`period=60` 等は `not entitled` で 400。長い窓/複数ルールは Pro 以上。
  §6 検証 OK（`/api/auth/login` 60連打→ 20×302 / 40×429・閾値超を正確に Block）。§5 AUTH_LIMITER は **残置で確定**（多層防御・フェイルオープン保険・無作業。WAF 障害時の保険として無害）。→ **独自ドメイン+WAF 一式 完了。**
- [ ] 入力サイズ上限（本文/コメント等）未設定（Workers が ~100MB で頭打ち・members 限定）
- [ ] CSP 未導入（index.html のインラインテーマ script に nonce/hash が要るため保留・X-Frame-Options で当面のクリックジャッキングは防御）
- [ ] esbuild moderate advisory（dev 専用の推移依存・本番無関係・上流更新待ち）

---

## H. AI レビューのエージェント化（✅ 完了・2026-06-13）
単発 LLM 呼び出し（Tier 0〜1）を **ネイティブ tool use ループ**（LangChain 不採用）へ引き上げ、参照リポジトリの実ファイル・
コメントスレッド・関連文書をモデルが自分で読んで根拠付きレビューするエージェント（Tier 2）にした。Anthropic/OpenAI 両対応・本番稼働。
- [x] 設計書 [`docs/ai-review-agent.md`](../ai-review-agent.md)（実装済み・全フェーズの実装メモ付き）
- [x] Phase A: `fetch_repo_file`・Anthropic 経路・方式X・プロンプトキャッシュ・テスト（縦切り最小）
- [x] Phase B: `list_repo_tree` / `get_doc_threads` / `search_docs`
- [x] Phase C: OpenAI `converse` パリティ ／ Phase D: web の `tool` イベント表示（進捗チップ・透明性）
- [x] 追加: `search_docs` を本文全文検索＋スニペットへ拡張（`documents.body` 同期列）
- 横断: プロンプトインジェクション対策（リポジトリ固定＋読了ファイルの透明性表示＋入力不信任宣言）・暴走ガード（MAX_TURNS=6 / MAX_TOOL_CALLS=12）

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
6. ⬜ **Cloudflare 実起動**（Workers + Hyperdrive→Postgres + R2）→ **Terraform(cloudflare)** → **CI(GitHub Actions)**
7. ⬜ （後回し）AWS 一式（RDS/Lambda or Fargate・Terraform aws・CodePipeline）

### フェーズ3: フロントエンド（フレームワーク・別フェーズ）
7. ⬜ 技術選定（SPA フレームワーク等。決めたら導入パッケージ同梱の `skills/SKILL.md` を確認）
8. ⬜ GAS 版パリティの全画面（D）: 文書一覧/フォルダ・エディタ(409体験)・コメントスレッド・
   ステータスボード・AI レビュー/改稿・通知・メンバー管理・取込/出力
