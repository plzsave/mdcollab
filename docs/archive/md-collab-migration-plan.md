# mdcollab（md-collab 脱 GAS 後継）移行計画書

> 📦 **アーカイブ（2026-07-13）。** 移行は完了し本番稼働中。設計判断の経緯の記録として残置（以後は編集しない）。現状の仕様は [`SPEC.md`](../../SPEC.md) を正とする。

> ステータス: ドラフト（検討用）
> 前提決定: **別リポジトリ** / **ポータブル一本化**（Web標準コア＋アダプタ層で複数ホスティングに同一コードで載せる） / 認証は**自前 Google OIDC に確定** / データは**フル移行(A)を第一候補**としつつ本体ストアを差し替え可能にして(B)Drive温存も設定で両立
>
> ⚠ この「フル移行 vs ハイブリッド」の分岐は**ホスティング選定に直結する**（Drive を残すなら GCP/Drive近接が有利、断てるなら Cloudflare が有利）。§4.2・§6.0 参照。

### 0. 二面性（個人開発 vs 職場利用）という上位制約
本計画は**2つの利用文脈を同時に満たす**ことを前提に再設計した。

- **個人開発のベスト = Cloudflare**（低コスト・低レイテンシ・スタック適合）。
- **職場利用のベスト = AWS**（社内に実績・承認パターンあり）、**次点 GCP**（僅少実績）。**Cloudflare は実績が無く利用許可が下りない可能性が高い**。
- 職場の環境は**混在型**: 業務 md 資料の ID/保管は **Google Workspace**、アプリ基盤は **AWS 中心**（GCP は僅少）。

#### 0.1 後継名 = `mdcollab`（命名スキーム確定）
新プロジェクトの永続名は **`mdcollab`**（旧 `md-collab` のハイフンを取った一語。血統を保ちつつクラウド中立で、`-v2`/`-next` のような暫定感がなくそのまま本名になる）。並走期間の取り違え（ハイフン1つ違い）を避けるため、**旧リポジトリは `md-collab-gas` にリネーム**し、`mdcollab` を新側に渡す（旧は実際 GAS 版なので名が正確になる／GitHub リネームはリダイレクトされ低コスト）。

| レイヤ | 名前 |
|---|---|
| 製品/永続名・リポジトリ・パッケージ・DB名 | `mdcollab`（private パッケージは `@yskab/mdcollab` でも可） |
| 旧リポジトリ | `md-collab-gas`（カットオーバー後に停止） |
| Terraform envs | `mdcollab-cf-personal` / `mdcollab-aws-workplace` / `mdcollab-gcp` |
| リソース prefix/tag | `mdcollab`（例: S3 `mdcollab-docs-<env>` / Workers `mdcollab-api` / RDS `mdcollab-<env>`） |
| OIDC クライアント名 | `mdcollab`（個人/職場で別クライアントID・同名） |

この二面性は「どちらを選ぶか」ではなく**設計で吸収する**。`md-collab`（→ 新 `mdcollab`）のワークロード（小〜中規模・低頻度書き込み・REST/JSON・Markdown本体＋関係メタ）は CF/AWS/GCP いずれにも素直に乗り、差が出るのは**アダプタ層（DB / 本体ストア / 認証 / 非同期）だけ**。よって方針は:

> **Web標準・ホスティング非依存のコアを一本書き、個人は Cloudflare、職場が必要になれば AWS にデプロイ。** 二重実装ではなくシーム（接合面）を最初から正しく引く（§5.1）。避けるべきロックインは実質 **Cloudflare Access** と **D1 固有SQL** の2つだけで、本計画はどちらも回避する。

---

## 1. 目的と前提

### 1.1 なぜ移行するか
現行の md-collab は Google Apps Script(GAS) Web アプリとして動作している。機能要件は満たしているが、**操作の要所で「もっさり」する**。原因はデータ量ではなく、GAS の構造的特性にある:

- `google.script.run` は呼び出しごとにサーバ dispatch が走り、**1往復あたりの固定オーバーヘッドが大きい**（数百ms〜秒）。
- バックエンドはスプレッドシートを DB 代わりに使うため、読み書きが遅く、`CacheService`/`LockService` で塗り固めて緩和している。
- 同時実行は `LockService`（スクリプト単位の排他）で直列化しており、本質的にスケールしない。

往復削減（`getDocumentBundle` 等）で改善はしたが、**プラットフォーム由来の下限**がある。実用的なレイテンシ（操作が即座に返る体験）には、通常のサーバ + 本物の DB への移行が必要。

### 1.2 スコープ
- 対象: md-collab の全機能（ドキュメント CRUD、フォルダ、コメントスレッド、メンバー/通知、ステータス、AIレビュー/反映、アップロード/ダウンロード、表集計）。
- 方針: **新リポジトリでフルスクラッチのバックエンド + データ層**を作り、**フロントは現行資産を最大限再利用**して API 層だけ差し替える。
- 非スコープ（当面）: ネイティブアプリ化、リアルタイム共同編集（CRDT/OT）、画像添付の本格対応。

---

## 2. 現状アーキテクチャの棚卸し（移行対象）

| 層 | 現行（GAS） | 移行時の扱い |
|---|---|---|
| フロント | 単一 `static/index.html` + インライン JS。`marked`/`DOMPurify`/`highlight.js`/`mermaid` を CDN 読み込み。Tailwind はビルドでインライン化 | **70–80% 再利用**。`google.script.run` 呼び出しを `fetch` ベースの API クライアントへ差し替え |
| 通信 | `google.script.run`（直列・往復重い） | REST/JSON（必要なら一部 SSE ストリーミング） |
| バックエンド | `src/Code.ts`（GAS 関数群） | **全面書き換え**（Hono 等の軽量 API） |
| ドキュメント本体 | Drive 上の `.md` ファイル（fileId が文書ID） | **オブジェクトストレージ**へ移行。文書IDは新規採番 |
| メタデータ | スプレッドシート `md-collab-db` の各シート（下記） | **リレーショナル DB** へ移行 |
| キャッシュ | `CacheService`(スクリプトキャッシュ) + `ScriptProperties` | 本物の DB で大半不要。必要なら KV/エッジキャッシュ |
| 同時実行/整合性 | `LockService`（全体直列） + 楽観ロック（`lastUpdated` 比較、`CONFLICT`） | **DB トランザクション + 条件付き更新（version 列）** |
| 認証 | マニフェスト `executeAs: USER_DEPLOYING` + `access: DOMAIN`、`Session.getActiveUser()` で訪問者を識別 | **要再設計（最難関）**。§7 |
| 認可 | `members` シート + `requireMember()`/`isOwner()` | DB の `members` テーブル + ロールで踏襲 |
| AI 連携 | GAS から `UrlFetchApp` で各プロバイダ呼び出し。キーは `ScriptProperties` に per-user 格納（クライアントへ非返却） | サーバから `fetch`。キーは暗号化保存。**ストリーミングで体感改善余地** |
| ビルド/デプロイ | Vite(gas-vite-plugin) + Tailwind + `inline-css` → **ローカルから `clasp push/deploy`（手動・CI なし）** | **Terraform(IaC) + CI（個人=GitHub Actions／職場=CodePipeline）**。デプロイ実体は repo スクリプトに集約し CI を差し替え可能に（§5.2） |
| 安全網 | Drive のネイティブ版履歴（誤上書きの保険） | **Drive 離脱で消える** → DB 側で版管理が必須（§6.4） |

### 2.1 現行データモデル（Sheets。ヘッダ無し・1行1レコード）
- `threads`（threadId, documentId, anchor{text,before,after}, status, createdBy/At, resolvedBy/At）
- `comments`（commentId, threadId, content, author, mentions, createdAt, updatedAt, deleted）
- `members`（email, displayName, addedAt, addedBy）
- `notifications`（notifId, recipient, type, threadId, commentId, documentId, documentName, isRead, createdAt, message）
- `folders`（folderId, name, **driveFolderId**, createdAt, createdBy）
- `statuses`（id, label, order）
- `doc_meta`（documentId, statusId, archived, assignee）
- `reviews`（reviewId, documentId, provider, model, content, createdBy, createdAt）
- `revisions`（documentId, createdBy, content, baseLastUpdated, provider, model, createdAt）— pending な AI 修正ドラフト（doc×user で1件）
- ドキュメント自体は Sheets に行を持たず、**Drive の `.md` ファイルとして存在**（`getDocumentList` が Drive を走査）。

> 重要: 現在 `documentId` = **Drive fileId** で、ほぼ全シートの外部キーになっている。フル移行では文書IDを新規採番し、**移行時に fileId → 新ID のマッピング**を作る必要がある。

---

## 3. 移行の基本方針

1. **別リポジトリ**で新規構築（コスト発生のため現行とは分離）。現行は移行完了までそのまま運用。
2. **データ移行の深さは要判断**: 第一候補は「Drive(.md)・Sheets を最終的に断つ**フル移行**」（2つの真実を残さない）。ただし **Drive 移行の難度が高い**ことが分かっており（§4.2）、難しければ「**ファイル本体は Drive に残すハイブリッド**」を正式な代替案として残す。この判断がホスティング選定を左右する。
3. **段階的に作る**（§11）。まず認証を1本通す PoC、次に読み取り API、書き込み、フロント差し替え、AI、最後にデータ移行とカットオーバー。
4. **不変条件を維持**: AIキーをクライアントへ返さない / 認可（メンバー制）/ 楽観的競合検知（CONFLICT）/ DOMPurify によるサニタイズ。
5. 依存パッケージのバージョンは**計画書に書かない**。新リポジトリで `bun add` 等によりパッケージマネージャに解決させる（互換性は peer 警告で確認）。

---

## 4. ホスティング候補比較

評価軸（◎>○>△>×）。md-collab の性質（小〜中規模・低頻度書き込み・Markdown中心・個人/小チーム・低コスト志向）で重み付け。

| 軸 | Cloudflare (Workers+Hono) | AWS (Lambda/Fargate) | GCP (Cloud Run) | Azure (Container Apps) | Vercel + 外部DB |
|---|---|---|---|---|---|
| **職場での採用可否（承認の通りやすさ）** | **× 実績なく許可困難** | **◎ 本命・社内実績/承認あり** | **○ 次点（僅少実績）** | △ | × |
| 1往復レイテンシ（移行の主目的） | ◎ エッジ実行 | ○ リージョン実行 | ○ リージョン実行 | ○ | ○ |
| ランニングコスト（低トラフィック） | ◎ 無料枠厚い/従量 | ○ Lambda従量／RDS micro は小額固定 | ○ Cloud Run はゼロスケール | △ | ○（DB別課金） |
| 同居データストア | ◎ D1(SQLite)/R2/KV が一体 | ◎ RDS/Aurora/DynamoDB/S3 | ◎ Firestore/Cloud SQL/GCS | ○ Cosmos/Postgres/Blob | △ 別サービス前提 |
| 認証の組み込み | ◎ Cloudflare Access（※本件は不採用） | ○ Cognito（※本件は自前OIDC） | ○ IAP/Identity Platform | ○ Entra ID | △ 自前/外部 |
| 既存スタック適合 | ◎ wrangler/vitest-pool-workers/TanStack 経験あり（個人） | ◎ 職場のアプリ基盤が AWS 中心 | ○ | △ | ○ |
| Google Drive 近接の利点 | △ | △（クロスクラウドだが Drive API 可） | ◎（**(B)Drive温存で価値**） | △ | △ |
| ベンダーロック回避 | ○（Hono は移植可） | ○ コンテナ/標準SQLで容易 | ○ コンテナで移植容易 | ○ | ○ |
| 運用の手数 | ◎ サーバレス | ○ サーバレス構成可 | ○ | △ | ○ |
| 重い/長時間処理（AI 等） | △ CPU時間に上限（緩和済だが要設計） | ◎ Lambda 15分・レスポンスストリーミング | ◎ 制限緩い | ◎ | △ |

### 4.1 所見（host 選定はデータ方針＋利用文脈に従属する）
ホスティングの優劣は単独では決まらず、**「Drive を断てるか／残すか」と「個人 or 職場のどちらで使うか」に従属する**。本計画はポータブル一本化（§5.1）でこの従属を吸収し、**デプロイ先を後から選べる**ようにする。

- **個人**: コスト・レイテンシ・スタック適合で **Cloudflare**。
- **職場**: 採用可否が最優先で **AWS が本命**（社内実績）、GCP 次点。Cloudflare は実績不足で非現実的。
- **AI 長時間処理の逆転に注意**: §8/§10 で Cloudflare 側の主要リスクだった「Workers の CPU 時間制約」は、**AWS では Lambda 15分タイムアウト＋レスポンスストリーミングで素直に解消**する。皮肉にも職場(AWS)版の方が AI 周りは楽。
- **DynamoDB は罠**: AWS の“真のサーバレスDB”は DynamoDB だが、§6.1 の関係スキーマ（FK・条件付き更新の楽観ロック）と不整合。関係DBを保つなら **RDS/Aurora Postgres** を選ぶ（§6.1）。

#### 4.1.1 データ方針(A/B)とホスティングの対応（従来整理・据え置き）

- **データをフル移行できる場合** → Drive 近接という GCP の最大利点が薄れ、低コスト・低レイテンシ・スタック適合で **Cloudflare（Workers + Hono + D1 + R2 + KV）が有力**。
  - 留意点: Workers の **CPU 時間/サブリクエスト制約**。AIレビューのような長時間 `fetch` は、(a) ストリーミング、(b) 重い処理だけ Cloud Run 等へ退避、(c) Queues 非同期化 のいずれかが必要。ここが Cloudflare 採用時の主要リスク。
- **Drive を残す（ハイブリッド）場合** → **GCP が最有力**。Drive/Workspace と同一エコシステムで、Drive API 呼び出し・OAuth・サービスアカウントの権限委譲（ドメイン全体委任等）が自然。Cloudflare からも Drive API は叩けるが、認証・レイテンシ・運用の素直さで GCP に分がある。
  - 加えて Cloud Run は **AI 等の長時間処理を制約なく素直に書ける**利点があり、ハイブリッドでなくても有力な対抗馬。
- **結論（提案）**: **二択を確定させてから host を決める**。フル移行が現実的なら Cloudflare、Drive 移行が重く残す判断ならGCP。どちらに転んでも破綻しないよう、§5 で両構成をマッピングしておく。現時点では **GCP・Cloudflare を対等の本命**として扱う。

### 4.2 Drive 移行の難度（ハイブリッド再評価の根拠）
フル移行で最も重いのが **Drive 上の `.md` 群の移送**であり、これが計画の不確実性の中心。難しくする要因:

| 要因 | 内容 |
|---|---|
| ネイティブ版履歴 | Drive のリビジョン履歴は**そのまま持ち出せない**。安全網を移すには `document_versions` を自前で作り直す必要（§6.4） |
| 既存フォルダのリンク運用 | 現行は**既存 Drive フォルダ（共有ドライブ含む）を `linkFolder` で取り込める**設計。利用者が Drive 側でも直接ファイルを編集・共有している可能性があり、Drive を断つと**その動線が消える** |
| 権限・共有 | Drive の共有設定・Workspace ドメイン権限に依存した運用を、新ストレージの認可へ写し替える必要 |
| 継続編集中の移送 | 運用中の文書を止めずに移すための並行稼働・差分取り込みが必要 |
| 文書ID = fileId | `documentId` が Drive fileId のため、全外部キーの張り替えが必須（§6.1） |

➡ これらが重いと判断されれば、**「ファイル本体は Drive、メタデータだけ新DB」のハイブリッド**が合理的な落としどころになり、その場合 **GCP が第一候補**に繰り上がる。逆に利用者が Drive を直接使っておらず、版履歴も自前で十分なら、フル移行 + Cloudflare が活きる。**Phase 0 でここを実地に見極める**。

---

## 5. ターゲットアーキテクチャ案（ポータブル一本化・3ホスティング対応）

| コンポーネント | Cloudflare 案（個人） | AWS 案（職場・本命） | GCP 案（職場・次点） |
|---|---|---|---|
| フロント配信 | Workers Assets / Pages | CloudFront + S3（or Amplify） | Cloud Run static / Firebase Hosting |
| API | Workers + Hono | Lambda + Hono（Lambda adapter）or App Runner/Fargate | Cloud Run + Hono |
| メタデータ DB | **Postgres**: Hyperdrive → Neon（無料枠・scale-to-zero） | **Postgres**: RDS `t4g.micro`（小額固定）※Aurora SLv2 は据え置き候補 | Cloud SQL(Postgres) |
| ドキュメント本体(.md) | **R2**（S3互換API） | **S3** | GCS（or S3互換モード） |
| キャッシュ/軽量KV | KV（必要時のみ） | ElastiCache/なし | Memorystore/なし |
| 認証 | **自前 Google OIDC**（Access 不採用） | **自前 Google OIDC**（Cognito 不採用） | **自前 Google OIDC** |
| シークレット（AIキー等） | Secrets + DB 暗号化列 | Secrets Manager/SSM + 暗号化列 | Secret Manager + 暗号化列 |
| 長時間/非同期(AI) | SSE ストリーミング / Queues | **Lambda 15分**（素直）/ SQS | Cloud Run（そのまま）/ Pub/Sub |
| IaC | **Terraform**（cloudflare provider） | **Terraform**（aws provider） | **Terraform**（google provider） |
| CI エンジン | **GitHub Actions** → repo スクリプト | **CodePipeline/CodeBuild** → repo スクリプト | Cloud Build/GH Actions → repo スクリプト |
| Terraform state backend | R2 or Terraform Cloud | **S3 + DynamoDB ロック**（標準） | GCS |

フロントの基本構造（単一HTMLの素朴さ）は維持してもよいし、運用が増えるなら TanStack Router/Start でコンポーネント化してもよい（任意・段階的）。**まずは API 層の差し替えだけで現行UIを動かすのが最短**。

### 5.1 移植シーム設計（二面性を吸収する接合面）
ポータビリティには**安い所と高い所**がある。安い所はタダで享受し、高い所（DB方言・認証）は明示的に隔離する。

**安い（ほぼタダで移植可能）**
- **API**: Hono は Web標準ベース。Workers / Lambda / Cloud Run で同一コード。
- **本体ストレージ**: **R2 は S3 互換API**、GCS も S3 互換モードあり → **S3 SDK 一本**で R2/S3/GCS を叩ける。§6.1 の `storage_key` 抽象がそのまま効く（実質ロックインゼロ）。
- **ランタイム規律**: 一番制約のキツい **Workers（Webランタイム・Node非互換）に合わせて書く**と、緩い Lambda(Node)/Cloud Run へ自動で乗る。**逆は地獄**。`fetch`/Web Crypto/標準ストリームのみ使い、Node固有API（`fs`/Buffer依存等）を避ける。

**高い（明示的に隔離する）**
- **DB方言**: SQLite(D1) と Postgres(RDS/Cloud SQL) は方言が違う。→ **Postgres エンジンに一本化**し（§6.1）、**Drizzle ＋ 薄いリポジトリ層**で隔離。個人=Neon／職場=RDS で同一スキーマ・同一クエリが走る。
- **認証**: **Cloudflare Access は最も剥がしにくいロックイン**。個人・職場とも Google Workspace で identity が立つので、**自前 Google OIDC 一本**にすれば全ホスティング共通（§7）。

**本体ストアのプラガブル化（(A)/(B)をフォークにしない）**
- 本体アクセスを `DocumentStore` インターフェイス（実装2つ：`S3Storage`＝R2/S3/GCS共通、`DriveStorage`＝Google Drive API）に切る。
- すると **(A)フル移行＝`S3Storage` / (B)Drive温存＝`DriveStorage`** は**デプロイ設定の切替**になり、個人=R2フル移行・職場=Drive温存、を**同一コードで両立**できる。職場の業務 md が Workspace 管理である点（(B)の実利）にも、速度優先でフル移行する個人にも、1コードで応えられる。

**避けるべきロックインは結局2つだけ**: ① 認証に Cloudflare Access を使わない（自前OIDC） ② D1固有SQL/拡張に深入りしない（標準SQL＋ORM）。これを守れば個人CF版→職場AWS版は**数週間のアダプタ作業**で済み、書き直しにならない。

### 5.2 CI/CD（デプロイもポータブルに）
現行は **ローカルから `clasp push/deploy`（手動・CI なし）**。移行を機に正式なパイプラインを引く。ここも「個人 vs 職場」で分岐するため、**CI エンジンを差し替え可能にする**のが核心。

**確定事項（今回の決定）**
- **IaC = Terraform 一本**。`modules/`（共通リソース形状）＋ `envs/`（`mdcollab-cf-personal` / `mdcollab-aws-workplace` / `mdcollab-gcp`）構成。provider を env ごとに切替え、CF/AWS/GCP を同一ツールで定義。リソースは `mdcollab-<env>` prefix で統一（§0.1）。
- **CI エンジンは個人=GitHub Actions／職場=AWS ネイティブ（CodePipeline/CodeBuild）**。両者が混在する以上、**デプロイ処理を CI の YAML に書かない**。実体は **repo 内スクリプト（Makefile/package scripts、例: `make deploy-aws` / `make deploy-cf`）**に置き、CI エンジンは「秘密注入＋スクリプト呼び出し」だけ担う。これで CI エンジン自体が§5.1 と同じ“差し替え可能なアダプタ”になる。

**パイプライン段階（共通）**
```
install → lint/typecheck → test(vitest / Workers は vitest-pool-workers)
       → build → terraform plan/apply(infra) → DB migrate(Drizzle)
       → deploy(artifact) → smoke test(post-deploy)
```

**キーレス認証（CI → クラウド）**
- 職場 CodeBuild → AWS: **CodeBuild のサービスロール**でそのまま権限取得（長期キー不要・最もクリーン）。Terraform state は **S3 + DynamoDB ロック**。
- 個人 GitHub Actions → Cloudflare: Cloudflare は GitHub OIDC 連携が無いため**スコープを絞った API トークン**を GH Secrets に。state は R2 or Terraform Cloud。
- 長期アクセスキーをリポジトリ/CI に置かない不変条件を維持。

**DB マイグレーション（Drizzle）の注意**
- 個人 Neon: 公開エンドポイントのため CI から直接 migrate 可。
- **職場 RDS は VPC 内**が通常 → マイグレーションジョブを **VPC 内（CodeBuild を VPC 接続）or Lambda マイグレーションランナー**で実行する必要がある（ここが職場側の主な手間）。
- **expand/contract パターン**で順序管理: 追加系（列追加等）はデプロイ前、破壊系（列削除）は次リリースでデプロイ後 → ゼロダウンタイムとロールバック安全性を確保。

**環境とテスト**
- 環境は staging / prod を基本。**CF は PR ごとの preview デプロイが安価**で効く。AWS の ephemeral 環境は重いので職場は staging+prod 中心。
- テストは **ランタイム非依存（Web標準）に書く**と1スイートで Workers/Lambda 両対応。デプロイ先ごとに薄い smoke test を後段に置く。

**シークレットの扱い**
- プラットフォーム秘密（DB接続・本体ストア資格情報・AIキー暗号化のマスター鍵）は **Secrets Manager/SSM（AWS）・Wrangler Secrets（CF）・Secret Manager（GCP）**に置き CI が注入。
- ユーザの AI キーは§6.5 のとおり**DBに暗号化保存**（CI 秘密ではない）。クライアント非返却の不変条件は不変。

**clasp からの移行**: 新リポジトリは Phase 0 から CI を持つ。現行 GAS（clasp 運用）はカットオーバー（Phase 5）まで現状維持で並走。

---

## 6. データモデル移行

### 6.0 二つのデータ方針（本節は両対応）
- **(A) フル移行**: メタは新 DB、本体 `.md` は R2/GCS。Drive を断つ。host は Cloudflare が有力。
- **(B) ハイブリッド**: メタだけ新 DB へ。**本体は Google Drive に残置**し、`documents.storage_key` の代わりに `drive_file_id` を保持。本体の読み書きは Drive API 経由。host は GCP が有力。
- 以降のスキーマ（§6.1）は両対応。**本体の置き場所だけが分岐**（`storage_key`(R2/GCS) ⟷ `drive_file_id`(Drive)）。version 管理・競合検知・認可・コメント等のメタ設計は共通。
- ハイブリッドの利点: 既存 Drive 資産・共有・ネイティブ版履歴・`linkFolder` 運用を温存でき、**移行が劇的に軽い**（本体を1バイトも動かさない）。欠点: Drive API のレイテンシ/クォータがレイテンシ改善の上限になる、Drive 直接編集との整合（メタの version と Drive 実体の乖離）に注意。

### 6.0.1 DBエンジンは Postgres に一本化（移植コスト最小）
**「Postgres というエンジンへのコミット」と「AWS のどの製品に乗せるか」を分離する**のが要点。ポータビリティを買うのは前者だけで、後者は後から選べる。

- 個人(CF): Workers + **Hyperdrive → Neon**（無料枠・scale-to-zero）。**Aurora は一切触らない**。
- 職場(AWS): **RDS for PostgreSQL `t4g.micro`**（小額固定・社内に承認/運用ノウハウがある想定）が現実解。バースト的なら Aurora Serverless v2（scale-to-zero）も候補だが、常用なら RDS micro の方が安く読める。
- これにより **D1 は使わない**代わりに、個人・職場で**同一スキーマ・同一クエリ・同一マイグレーション**が走る（Drizzle ＋ 薄いリポジトリ層）。「Aurora のコストが不安」＝「Postgres 一本化が不安」ではない点に注意。

### 6.1 リレーショナルスキーマ案（Postgres 一本化の素案）
```
documents(
  id TEXT PK,                 -- 新規採番（旧 Drive fileId は migration_source に保持）
  folder_id TEXT FK,
  title TEXT,
  storage_key TEXT,           -- (A)フル移行: R2/GCS 上の本体キー ／ (B)ハイブリッド: 代わりに drive_file_id を保持
  version INTEGER NOT NULL,   -- 楽観ロック用（旧 lastUpdated の代替）
  status_id TEXT, archived INTEGER, assignee TEXT,  -- 旧 doc_meta を統合
  created_by TEXT, created_at TEXT, updated_at TEXT,
  migration_source TEXT       -- 旧 Drive fileId（移行検証・ロールバック用）
)
folders(id PK, name, created_by, created_at)         -- driveFolderId は廃止
members(email PK, display_name, role, added_by, added_at)
statuses(id PK, label, sort_order)
threads(id PK, document_id FK, anchor_text, anchor_before, anchor_after,
        status, created_by, created_at, resolved_by, resolved_at)
comments(id PK, thread_id FK, content, author, mentions, created_at, updated_at, deleted)
notifications(id PK, recipient, type, thread_id, comment_id, document_id,
              document_name, is_read, created_at, message)
reviews(id PK, document_id FK, provider, model, content, created_by, created_at)
revisions(id PK, document_id FK, created_by, content, base_version,
          provider, model, created_at, UNIQUE(document_id, created_by))
ai_keys(email, provider, encrypted_key, PRIMARY KEY(email, provider))  -- 旧 ScriptProperties
document_versions(document_id FK, version, storage_key, created_by, created_at)  -- §6.4
```
- 旧 `mentions`（カンマ区切り文字列）は当面そのまま文字列で移送、将来正規化可。
- `documentId` 外部キーは**旧 fileId → 新 id へ一括置換**（移行スクリプトでマッピング適用）。

### 6.2 本体ファイル（`DocumentStore` インターフェイスで隔離）
本体アクセスは**プラガブルな `DocumentStore` インターフェイス**に切り、(A)/(B) をフォークにしない（§5.1）。
- 実装① `S3Storage`（(A)フル移行）: Drive の各 `.md` を R2/S3/GCS に `storage_key`（例: `docs/{documentId}/{version}.md`）で保存。S3 互換APIなので3クラウド共通。
- 実装② `DriveStorage`（(B)Drive温存）: 本体は Google Drive に残置し `drive_file_id` で参照。読み書きは Drive API 経由。
- 取得は API 経由（署名URL or サーバ中継）。一覧はメタデータ DB から引く（Drive 走査をやめてここで高速化）。
- デプロイ設定で実装を切替: 個人=`S3Storage`(R2)／職場=`S3Storage`(S3) or `DriveStorage`（業務 md が Workspace 管理のため温存に実利）。**(B)は Drive API 往復がレイテンシ上限になる**トレードオフに留意（§6.0 欠点）。

### 6.3 同時実行・整合性
- 旧 `updateDocument(fileId, content, expectedLastUpdated)` → `PUT /documents/:id`（`If-Match: version`）。
- サーバは `UPDATE ... WHERE id=? AND version=?` の**条件付き更新**で 0 行なら `409 CONFLICT`。GAS の `LockService` 全体直列は不要になり、行単位の競合検知に置き換わる（スケールする）。
- 本体は「新 version の storage_key に書く → メタを条件付き更新」の順で、失敗時に孤児ファイルが残っても無害な設計に。

### 6.4 版管理（Drive 安全網の代替・重要）
Drive のネイティブ版履歴という「誤上書きの保険」が**移行で消える**。代替として `document_versions` に版を残し、復元 API を用意する（最低限、直近 N 版 or 全版）。AI 反映・上書き保存の安心材料として必須級。

### 6.5 AIキー（秘密情報）
- 旧: `ScriptProperties` の `ai:key:<provider>:<email>`（`executeAs USER_DEPLOYING` のため getUserProperties が共有になる問題を回避する命名）。
- 新: `ai_keys` テーブルに**暗号化して保存**（鍵はプラットフォームのシークレット管理）。**クライアントへ平文返却しない不変条件は維持**。

### 6.6 移行スクリプト
1. 現行 GAS に**エクスポート用エンドポイント**を一時追加（各シート JSON + 文書一覧 + 本文）。
2. 取り込み側: fileId→新id マップを作り、本体を R2/GCS へ、メタを DB へ投入、外部キーを張り替え。
3. **並行稼働期間**: 旧を read-only、新を本番化。`migration_source` で突き合わせ検証。
4. 問題なければカットオーバー、一定期間後に旧を停止。

---

## 7. 認証・認可（**確定: 自前 Google OIDC 一本**）

> **決定**: 個人・職場とも identity が **Google Workspace** で立っている（職場の業務 md も Workspace 管理）。よって**全ホスティング共通で「自前 Google OIDC」に確定**。Cloudflare Access は採らない（職場で剥がせないロックインのため）。**この決定により §7 の「最難関」評価は1ランク下がる** — Google OAuth が個人・職場で共通の地盤になり、ホスティング非依存で再利用できる。

現行は **Workspace 同一ドメイン限定（`access: DOMAIN`）+ deployer 権限で実行（`executeAs: USER_DEPLOYING`）+ `Session.getActiveUser()` で訪問者識別**、その上に `members` 認可を重ねている。移行ではこの3点を別々に再現する必要がある。

### 7.1 識別（訪問者は誰か）候補比較
| 方式 | 概要 | 長所 | 短所/留意 |
|---|---|---|---|
| **Google OIDC（自前）** | Google でログイン → IDトークン検証 → 自前セッション(Cookie) | 現行と同じ体験／Drive 連携を残す場合は必須 | セッション/CSRF/トークン更新を自前実装 |
| **Cloudflare Access** | アプリ手前で IdP 認証を強制、検証済みJWTをアプリへ | 実装が薄い／Google 以外の IdP も容易／ゼロトラスト | Cloudflare ロックイン／JWT 検証だけは実装 |
| **マネージド Auth（Auth0/Clerk 等）** | 外部 IaaS に委譲 | 早い／多要素や管理UI付き | 月額コスト／外部依存 |
| **マジックリンク/自前** | メールリンクでログイン | Google 非依存 | 配信・セキュリティ自前 |

- **採用案 = 自前 Google OIDC**（上記決定）。Google でログイン → IDトークン検証 → 自前セッション(Cookie)。任意ランタイムで動くライブラリ（better-auth/Lucia 等）を使えば Workers/Lambda/Cloud Run 共通で実装でき、移植性も担保。
- 不採用: Cloudflare Access（職場で剥がせない）／マネージド Auth（月額固定が乗る・外部依存）。
- 補足: フル移行(A)でも、職場・個人とも Workspace を使う以上、ログインに Google を使うのが最も自然（選択肢を広げる必要がない）。

### 7.2 ドメイン制限（`access: DOMAIN` の代替）
- 「特定 Workspace ドメインの人だけ」を再現するには、IdP 側のドメイン制限 or アプリ側で `email` ドメインを検査。
- ただし現行も結局 `members` で絞っているので、**ドメイン制限は「入口の粗いフィルタ」、`members` が「正の認可」**という二段構えを踏襲すれば十分。

### 7.3 認可（何ができるか）
- 既存の `members` モデルをそのまま DB 化（`role`: owner/member）。`requireMember()`/`isOwner()` 相当を API ミドルウェアで実装。
- `executeAs USER_DEPLOYING`（= deployer 権限で Drive 操作）の代替は不要になる。リソースは自前 DB/オブジェクトストレージなので、**アプリのサービスクレデンシャルで一元管理**し、行レベルで `members` 認可をかける。
- 現行で注意していた IDOR（deployer がアクセスできる任意ファイルを触らせない）対策は、**全リソースを folder/document → members で必ずスコープする**ことで踏襲。

---

## 8. AI レビュー連携
- 現行: GAS から `UrlFetchApp`（同期・非ストリーミング）。Claude は REST 直叩き（`anthropic-version` ヘッダ固定、新機能は `anthropic-beta`）。OpenAI/Gemini も同様。
- 新: サーバ（Workers/Cloud Run）から `fetch`。**SSE ストリーミング対応**でレビュー/反映の体感を大きく改善できる。
- キー秘匿・プロバイダ分岐（claude/openai/gemini）・モデル一覧取得（`/models`）は現行ロジックを移植。
- Workers 採用時は CPU 時間制約に注意（§4.1）。長い生成はストリーミング or 別ランタイムへ。

---

## 9. フロントエンド再利用方針
- 現行は単一 HTML + インライン JS。サーバ通信は全て `google.script.run.xxx(...).withSuccessHandler(...)`。
- **抽象化レイヤを1枚挟む**: `api.xxx()` → 内部で `fetch('/api/xxx')`。まず薄いラッパで現行UIをほぼそのまま動かす。
- CDN ライブラリ（`marked`/`DOMPurify`/`highlight.js`/`mermaid`）は据え置き可（後でバンドル化も可）。
- 差分ビュー・AI反映ドラフト・表集計・コメントアンカー等の**UI ロジックはそのまま再利用**（70–80%）。
- 任意の発展: ルーティング/状態管理が重くなったら TanStack へ段階移行（**着手前に同梱 `skills/SKILL.md` を確認**）。
- **API 契約は `mdcollab-api-inventory.md` に確定済み**（旧 45 RPC → REST マッピング）。`api.xxx()` 層はこの表へ束ねる。

---

## 10. リスクと課題
| リスク | 影響 | 緩和策 |
|---|---|---|
| 認証の作り込み | 最難関・遅延要因 | PoC を Phase 0 で先に1本通す。Access 採用で実装を薄く |
| Workers の CPU/サブリクエスト制約（AI） | 長時間生成が失敗 | ストリーミング/Queues/Cloud Run 退避を PoC で確認 |
| データ移行の整合性・ダウンタイム | 文書喪失/不整合 | `migration_source` 突合・並行稼働・read-only 期間 |
| Drive 版履歴の喪失 | 誤上書きの保険消失 | `document_versions` + 復元 API を必須実装（§6.4） |
| コスト管理 | 想定外課金 | 無料枠/従量を試算（§12）・上限アラート |
| 同時編集の再設計 | 競合時の挙動 | version 条件付き更新で CONFLICT を踏襲（CRDT は非スコープ） |
| ベンダーロック | 将来移植困難 | Hono/コンテナ・標準SQL・Terraform でロック最小化。デプロイ実体を repo スクリプトに集約し CI エンジンも差し替え可能に（§5.2） |
| 職場 RDS マイグレーション | VPC 内 DB へ CI から到達できず詰まる | CodeBuild を VPC 接続 or Lambda マイグレーションランナー。expand/contract で順序管理（§5.2） |

---

## 11. 段階的移行ロードマップ
- **Phase 0 — 土台確定（PoC・ポータビリティ実証込み）**: **Drive 移行難度の実地評価で A(フル移行)/B(ハイブリッド) を確定** → 認証を **Cloudflare Access ではなく自前 Google OIDC で1本通す**（職場ポートに直結）、`DocumentStore` を `S3Storage`/`DriveStorage` の2実装で噛ませる、DB を **Neon(個人)/RDS(職場) いずれでも同一クエリで動く**ことを Drizzle で確認、AI 長時間処理を「Workersで頑張る」と「Lambda相当なら無問題」の両面で検証。さらに **Terraform 骨組み＋repo デプロイスクリプト＋最小 CI（個人=GitHub Actions）**を立て、デプロイ実体を CI から切り離す形を確立（§5.2）。← Phase 0 の成果物が「個人CF版の土台」**かつ**「職場AWS移植性の実証」を兼ねる（追加コストは主に認証を Access にしないだけ）。
- **Phase 1 — データ設計 + 読み取り**: スキーマ確定、文書一覧/取得・コメント取得など read API、フロントの読み取り経路を新APIへ。
- **Phase 2 — 書き込み + 整合性**: 文書保存（version 条件付き更新/CONFLICT）、コメント/スレッド、メンバー/通知、ステータス。版管理（§6.4）。
- **Phase 3 — フロント差し替え**: `google.script.run` ラッパを `fetch` 実装へ。現行UIを新バックエンドで一通り動かす。
- **Phase 4 — AI 連携 + 秘密管理**: レビュー/反映/モデル一覧、キー暗号化、ストリーミング。
- **Phase 5 — データ移行 + カットオーバー**: 移行スクリプト、並行稼働・検証、本番切替、旧停止。

各 Phase 末で実機確認（現行の運用ルールを踏襲）。

---

## 12. コスト概算（ラフ・低トラフィック前提）
- **Cloudflare**: Workers/D1/R2/KV とも無料枠が厚く、小チーム運用なら**月額ほぼ無料〜数ドル**圏内が現実的。R2 はエグレス無料が効く。
- **GCP**: Cloud Run はゼロスケールで待機コスト小。ただし Cloud SQL を使うと**常時起動の DB 課金**が乗る（Firestore なら従量で抑えやすい）。
- **マネージド Auth（Auth0/Clerk）**を足すと月額固定が乗る。Access/自前 OIDC なら回避可能。
- 正確な試算は Phase 0 で実測トラフィックを当てて確定する。

---

## 13. 未決事項 / 次アクション

### 13.0 確定済み（二面性分析の結論）
- **後継名 = `mdcollab`**（旧は `md-collab-gas` へ改名）。命名スキームは §0.1。
- **向き合い方 = ポータブル一本化**（Web標準コア＋アダプタ層／§5.1）。個人=Cloudflare、職場=AWS を同一コードで両対応。
- **認証 = 自前 Google OIDC 一本**（§7）。Cloudflare Access 不採用。
- **DBエンジン = Postgres 一本化**（§6.0.1）。個人=Neon(Hyperdrive)／職場=**RDS micro 想定**（Aurora は据え置き候補）。D1 は使わない。
- **本体ストア = `DocumentStore` プラガブル**（§6.2）。(A)`S3Storage` / (B)`DriveStorage` をデプロイ設定で切替。
- **IaC = Terraform 一本／CI = 個人GitHub Actions・職場CodePipeline**（§5.2）。デプロイ実体は repo スクリプトに集約し CI エンジンを差し替え可能に。
- **避けるべきロックイン = Cloudflare Access と D1固有SQL の2点のみ**（両方とも回避済み）。

### 13.1 残る未決
1. **データ方針 A/B の最終確定**: フル移行(A) か Drive 温存(B) か。`DocumentStore` 抽象でフォークは避けたが、個人=(A)/職場=(B) の混在運用を許すか、両方(A)に寄せるかは Phase 0 で判断。判断材料は §4.2（特に「利用者が Drive を直接使っているか」「版履歴を自前で代替できるか」）。職場は業務 md が Workspace 管理のため(B)に実利あり／個人は速度優先で(A)が自然。
2. **職場AWSのDB製品**: RDS `t4g.micro`（小額固定）を第一候補に、Aurora Serverless v2（scale-to-zero）と比較。利用パターン（常用 or バースト）を見て確定。
3. **職場RDSマイグレーション経路**: CodeBuild の VPC 接続か Lambda ランナーか（§5.2）。職場ネットワーク制約を Phase 0 で確認。
4. **フロント刷新の深さ**: 現行HTML据え置き or TanStack 化（段階）。
5. **版管理の範囲**: 全版保持か直近N版か（(B)なら Drive 版履歴を流用できる）。
6. **次アクション提案**: Phase 0 のPoC で **(1) Drive 移行難度の実地評価（A/B の判断）**、(2) 自前OIDC 1本通し、(3) `DocumentStore` 2実装、(4) Neon/RDS 同一クエリ確認、(5) AIストリーミング/Lambda両面検証、(6) **Terraform `modules/`＋`envs/` 骨組みと repo デプロイスクリプトの雛形**（CI から呼ぶだけの形）をまとめて行う。A/B が決まれば host 別（CF/AWS）のリポジトリ雛形を用意する。
   - ✅ **API インベントリは作成済み**（`mdcollab-api-inventory.md`／旧 45 RPC → REST）。Phase 1 はこれを契約に実装する。

---

_この計画書は検討用ドラフト。決定が出たら該当節を更新し、Phase 0 着手時に新リポジトリへ移設する。_
