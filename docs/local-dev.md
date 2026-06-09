# ローカル実起動 検証ランブック

明日の検証用。**Google OAuth は不要**（`DEV_AUTH=1` の dev ログインを使う）。
バッキングサービス（Postgres / S3）だけ docker-compose で建て、アプリはホストで動かす。

## 必要なもの

- Docker（`docker compose`）
- bun（インストール済み）
- direnv（環境変数の自動読み込み用・任意だが推奨）
- `curl` と `jq`（任意・出力整形用）

## 手順

### 1. 環境変数

```bash
cp .dev.vars.example .dev.vars
# .dev.vars の SEED_EMAIL を自分のメールに変更（dev ログインで使う email と揃える）
direnv allow   # 初回だけ。以後はこのディレクトリに入ると .dev.vars が自動で読み込まれる
echo $DATABASE_URL   # 値が出れば読み込み成功
```
direnv が無い環境では代わりに毎回 `set -a; source .dev.vars; set +a` で読み込む。

### 2. バッキングサービス起動（Postgres + S3）

```bash
make up          # docker compose up -d（postgres と SeaweedFS S3）
docker compose ps  # healthy になるまで待つ
```
S3 バケット `mdcollab-docs-dev` は **seed の初回 PUT で自動生成**される（事前作成不要）。

### 3. スキーマ適用 + シード

```bash
make migrate     # drizzle migrate（drizzle/0000_*.sql を適用）
make seed        # member(あなた) + folder + document(本体を S3 へ) を投入
```
`make migrate` の代わりに `bun run db:push`（マイグレーション無しで直接同期）でもよい。

### 4. アプリ起動

```bash
bun run dev      # http://localhost:8787
# 別ターミナルで:
curl -s localhost:8787/health      # {"ok":true}
```

### 5. dev ログイン（Cookie 取得）

```bash
# DEV_AUTH=1 のときだけ有効。SEED_EMAIL と同じ email を使う。
curl -s -c cookie.txt "localhost:8787/api/auth/dev-login?email=$SEED_EMAIL"
# {"ok":true,"email":"...","devAuth":true}
```

### 6. 検証本番：読み取りと「競合更新(409)」

```bash
# ブートストラップ束
curl -s -b cookie.txt localhost:8787/api/state | jq

# シードした文書を取得（version=1）
curl -s -b cookie.txt localhost:8787/api/documents/seed-doc | jq

# 正しい version で更新 → version=2 になる
curl -s -b cookie.txt -X PUT localhost:8787/api/documents/seed-doc \
  -H 'If-Match: 1' -H 'Content-Type: application/json' \
  -d '{"content":"# 更新版\n\n本文を書き換えた。"}' | jq

# わざと古い version で更新 → 409 CONFLICT（楽観ロックが効いている証拠・§6.3）
curl -s -b cookie.txt -X PUT localhost:8787/api/documents/seed-doc \
  -H 'If-Match: 1' -H 'Content-Type: application/json' \
  -d '{"content":"これは衝突するはず"}' -w '\nHTTP %{http_code}\n'
```

期待結果:
- 2回目の PUT が `409` ＋ `{"error":{"code":"CONFLICT",...},"current":2}`。
- `document_versions` に v1/v2 が積まれている（版管理＝Drive 安全網の代替・§6.4）。
- S3 に `docs/seed-doc/1.md` と `docs/seed-doc/2.md` が出来ている（filer で確認・任意）:
  ```bash
  # filer は既定で HTML を返すので JSON が欲しければ Accept ヘッダを付ける
  curl -s -H 'Accept: application/json' http://localhost:8888/buckets/mdcollab-docs-dev/docs/seed-doc/ | jq
  ```
  ブラウザで `http://localhost:8888/buckets/mdcollab-docs-dev/docs/seed-doc/` を開いてもよい。
  （そもそも GET /api/documents が本文を返せている時点で S3 から読めている証拠なので、この確認は任意）

### 7. Statuses / Members（owner 専用操作の確認）

seed したメンバー（`SEED_EMAIL`）は **owner** なので、owner 限定の書き込みも試せる。

```bash
# ステータス: 一括置換(owner) → GET で反映確認
curl -s -b cookie.txt -X PUT localhost:8787/api/statuses \
  -H 'Content-Type: application/json' \
  -d '[{"label":"Draft","sortOrder":0},{"label":"Review","sortOrder":1},{"label":"Done","sortOrder":2}]' | jq
curl -s -b cookie.txt localhost:8787/api/statuses | jq '[.[].label]'   # ["Draft","Review","Done"]

# メンバー: 追加(owner) → 一覧 → 改名(PATCH) → 削除(DELETE)
curl -s -b cookie.txt -X POST localhost:8787/api/members \
  -H 'Content-Type: application/json' \
  -d '{"email":"teammate@example.com","displayName":"Teammate"}' | jq
curl -s -b cookie.txt localhost:8787/api/members | jq '[.[].email]'
curl -s -b cookie.txt -X PATCH localhost:8787/api/members/teammate@example.com \
  -H 'Content-Type: application/json' -d '{"displayName":"改名後"}' | jq
curl -s -b cookie.txt -X DELETE localhost:8787/api/members/teammate@example.com | jq

# 締め出し防止: 最後の owner(自分) は降格/削除できない → 400
curl -s -b cookie.txt -X DELETE "localhost:8787/api/members/$SEED_EMAIL" -w '\nHTTP %{http_code}\n'
```

期待結果:
- statuses PUT が `sortOrder` 順で返り、GET にも反映される。
- members の add→list→patch→delete が一通り動く。
- 最後の owner の DELETE が `400`（`cannot remove the last owner`）。

> 単体テスト（`bun run test`）は docker 不要で同じロジックを検証する（pglite + メモリストア）。
> ここでの curl は「実プロセス＋実 Postgres でも動く」最終確認。

### 8. Documents 残り（作成・一覧・取込・PATCH・削除）／ folder rename・delete

```bash
# フォルダ作成 → そのフォルダに文書を新規作成（folderId は seed-folder）
curl -s -b cookie.txt -X POST localhost:8787/api/documents \
  -H 'Content-Type: application/json' \
  -d '{"folderId":"seed-folder","title":"新規ドキュメント"}' | jq '{id,title,version}'

# フォルダ内の文書メタ一覧（本文は含まれない＝軽量）
curl -s -b cookie.txt localhost:8787/api/folders/seed-folder/documents | jq '[.[].title]'

# 取込（複数ファイル）→ per-file 成否
curl -s -b cookie.txt -X POST localhost:8787/api/documents/import \
  -H 'Content-Type: application/json' \
  -d '{"folderId":"seed-folder","files":[{"name":"a.md","content":"# A"},{"name":"b.md","content":"# B"}]}' | jq

# メタ更新（status/archived/assignee/title を1本で）
curl -s -b cookie.txt -X PATCH localhost:8787/api/documents/seed-doc \
  -H 'Content-Type: application/json' -d '{"statusId":"review","assignee":"'"$SEED_EMAIL"'"}' | jq '{statusId,assignee}'

# folder rename / 空でない folder の削除 → 409
curl -s -b cookie.txt -X PATCH localhost:8787/api/folders/seed-folder \
  -H 'Content-Type: application/json' -d '{"name":"改名フォルダ"}' | jq '{id,name}'
curl -s -b cookie.txt -X DELETE localhost:8787/api/folders/seed-folder -w '\nHTTP %{http_code}\n'  # 中身があれば 409
```
> `statusId` は §7 で `draft/review/done` を投入済みの前提（または `/api/setup` で既定投入）。

### 9. Threads / Comments ＋ Notifications（通知発火）

```bash
# スレッド作成（初コメント＋自分への mention は飛ばない）。2人目を試すなら別 email で dev-login。
TID=$(curl -s -b cookie.txt -X POST localhost:8787/api/documents/seed-doc/threads \
  -H 'Content-Type: application/json' \
  -d '{"anchorText":"ここ","firstComment":"確認お願いします"}' | jq -r .id)

# 返信 → スレッド参加者に reply 通知
curl -s -b cookie.txt -X POST localhost:8787/api/threads/$TID/comments \
  -H 'Content-Type: application/json' -d '{"content":"対応しました"}' | jq '{id,content}'

# スレッド一覧（コメント同梱）／ resolve → reopen
curl -s -b cookie.txt localhost:8787/api/documents/seed-doc/threads | jq '[.[] | {id,status,comments:(.comments|length)}]'
curl -s -b cookie.txt -X POST localhost:8787/api/threads/$TID/resolve | jq
curl -s -b cookie.txt -X POST localhost:8787/api/threads/$TID/reopen | jq

# 通知: 一覧 → 既読化 → 全既読
curl -s -b cookie.txt localhost:8787/api/notifications | jq '[.[] | {type,isRead}]'
curl -s -b cookie.txt -X POST localhost:8787/api/notifications/read-all | jq
```
> mention/reply の宛先を実感したい場合は、別の email で dev-login して別メンバーを作り（`/api/members` で owner が追加）、
> その人を `mentions:["other@example.com"]` に入れる／その人として返信する、と通知が飛ぶ先が変わる。

### 10. AI Settings / Review（暗号化・SSE）

**鍵の保存と「平文を返さない」不変条件はプロバイダ無しで確認できる**。実レビュー（`review`/`models`）は
実プロバイダ API を叩くので、本物の APIキーがある時だけ。

```bash
# キー保存（暗号化されて入る）→ GET は has-key 真偽のみで平文を返さないことを確認
curl -s -b cookie.txt -X PUT localhost:8787/api/ai/settings \
  -H 'Content-Type: application/json' \
  -d '{"provider":"anthropic","model":"claude-opus-4-8","apiKey":"sk-dummy"}' | jq
curl -s -b cookie.txt localhost:8787/api/ai/settings | jq   # keys:{anthropic:true} のみ・apiKey は出ない

# DB を直接覗いても平文は無い（暗号文だけ）
docker compose exec -T postgres psql -U mdcollab -d mdcollab -c \
  "select email, provider, left(encrypted_key,16) as enc_head from ai_keys;"
```

**本物の APIキーがある場合のみ**（`sk-dummy` を実キーに差し替えてから）:
```bash
# モデル一覧（プロバイダ /models 中継）
curl -s -b cookie.txt "localhost:8787/api/ai/models?provider=anthropic" | jq

# レビュー（非ストリーム）／ SSE ストリーミング
curl -s -b cookie.txt -X POST localhost:8787/api/documents/seed-doc/review \
  -H 'Content-Type: application/json' -d '{"instructions":"簡潔に"}' | jq '{provider,model,review}'
curl -N -s -b cookie.txt -X POST "localhost:8787/api/documents/seed-doc/review?stream=1" \
  -H 'Content-Type: application/json' -d '{"instructions":""}'   # event: delta... event: done が流れる
```

### 11. setup（初回ブートストラップ・任意）

`make seed` 済みの DB では owner が既に居るので `bootstrapped:false`（冪等）になる。
**まっさらな DB**（`make migrate` だけで seed していない）で叩くと、叩いた本人が owner になる:
```bash
curl -s -b cookie.txt -X POST localhost:8787/api/setup -H 'Content-Type: application/json' -d '{"displayName":"私"}' | jq
# {"ok":true,"bootstrapped": true=初回 / false=既に owner あり }
```

### 片付け

```bash
make down        # コンテナ停止（pgdata ボリュームは残る。完全削除は docker compose down -v）
```

## これで確認できること（=シームが本当に動くか）

- **Postgres + Drizzle**（メタ）／**S3 互換ストア**（本体）／**自前セッション**（認可）が連携して動く。
- **If-Match 条件付き更新 → 409**（移行の主目的だった整合性モデル）。
- **DocumentStore 抽象**（今回は S3。(B)Drive は別途）。
- **owner/member 認可**（statuses/members/setup の owner 限定・締め出し防止）。
- **通知の副作用発火**（mention/reply/resolve がレコード化される・§9）。
- **秘密の暗号化保存**（ai_keys に平文が無い・API は has-key 真偽のみ返す・§10）。
- **SSE ストリーミング**（review の `?stream=1`・実キーがある場合・§10）。

> §8〜§11 はバックエンドのパリティ確認。実 AI レビューだけは本物の APIキーが要る（それ以外は鍵不要）。

## トラブルシュート

- `403 not a member`: dev ログインの email と `SEED_EMAIL` がズレている。揃える。
- `S3 put failed`: SeaweedFS がまだ起動途中。`docker compose ps` で healthy を待ち、`make logs` を確認。
- バケットが出来ない（NoSuchBucket）: 通常は初回 PUT で自動生成される。手動なら filer に作る:
  `curl -X POST http://localhost:8888/buckets/mdcollab-docs-dev/` もしくは
  `echo "s3.bucket.create -name mdcollab-docs-dev" | docker compose exec -T s3 weed shell -master=localhost:9333`
- 別の S3 実装にしたい: `docker-compose.yml` の `s3` サービスのみ差し替え、`S3_ENDPOINT` を合わせる（アプリは path-style なので無改修）。
