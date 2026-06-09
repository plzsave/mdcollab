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

### 片付け

```bash
make down        # コンテナ停止（pgdata ボリュームは残る。完全削除は docker compose down -v）
```

## これで確認できること（=シームが本当に動くか）

- **Postgres + Drizzle**（メタ）／**S3 互換ストア**（本体）／**自前セッション**（認可）が連携して動く。
- **If-Match 条件付き更新 → 409**（移行の主目的だった整合性モデル）。
- **DocumentStore 抽象**（今回は S3。(B)Drive は別途）。

## トラブルシュート

- `403 not a member`: dev ログインの email と `SEED_EMAIL` がズレている。揃える。
- `S3 put failed`: SeaweedFS がまだ起動途中。`docker compose ps` で healthy を待ち、`make logs` を確認。
- バケットが出来ない（NoSuchBucket）: 通常は初回 PUT で自動生成される。手動なら filer に作る:
  `curl -X POST http://localhost:8888/buckets/mdcollab-docs-dev/` もしくは
  `echo "s3.bucket.create -name mdcollab-docs-dev" | docker compose exec -T s3 weed shell -master=localhost:9333`
- 別の S3 実装にしたい: `docker-compose.yml` の `s3` サービスのみ差し替え、`S3_ENDPOINT` を合わせる（アプリは path-style なので無改修）。
