# AI レビュー指摘のコメントスレッド化（① 設計）

**前提**: AI レビューのエージェント化（[`ai-review-agent.md`](ai-review-agent.md) / [`-v2`](ai-review-agent-v2.md)・Phase A〜H, G2）は実装・本番稼働済み。本書はそこで保留にしていた **① 指摘のコメントスレッド化** を定める。

> ステータス: **設計中（v1 実装へ）**。追跡は [#14](https://github.com/plzsave/mdcollab/issues/14)。
> 対象: `src/routes/reviews.ts` / `src/ai/findings.ts` / `web/`（既存 `threads`/`comments` を再利用・**スキーマ変更なし**）。

## 目的

現状の AI レビューは「1 枚の Markdown 講評」を出すだけ。読み手は「どこの話か」を自分で探す必要がある。
① は**指摘を本文の該当箇所にアンカーしたコメントスレッド**にし、既存の人間コメントと同じ仕組み
（アンカー・解決・返信・ジャンプ）に乗せる。改稿（全文書き換え）と違い、**指摘ごとに人が採否を判断**でき、
著者のコントロールと検証性を保ったまま、局所的で実行可能な指摘を得られる。

## スパイク結果（go/no-go の根拠）

`scripts/eval-anchor.ts`（実モデル）で計測（[#40](https://github.com/plzsave/mdcollab/pull/40)）:
- **逐語再現 100%**: モデルは本文から指摘箇所を正確に逐語引用できる（fuzzy 不要）。
- **描画後ハイライト可能 ~69%**: web のハイライト（`web/src/lib/highlight.ts`）はレンダリング後テキストの
  単一テキストノード内 `indexOf`（`PRE`/`CODE` スキップ）。光らない指摘は**ほぼすべてインラインコード
  （`` `…` ``）をまたぐ引用**（PAT・スコープ・命名・型など、対象が識別子の高価値指摘）。
- **重要**: アンカーできない指摘も**コメントパネルにはスレッドとして表示される**（ハイライトは別レイヤ・
  見つからなければ無視）。＝**degrade は自動で成立**。現状の講評は inline 0% なので、① は確実に上。

## 設計（v1・degrade 版）

### 出力＝構造化 finding（LLM は read-only）
レビュー最終出力を自由文ではなく **finding の JSON 配列**にする。スレッド生成は**ルート側**が行い、
モデルには書き込みツールを持たせない（インジェクション安全）。`src/ai/findings.ts` の `parseFindings`
（救済パース）/ `anchorQuote` / `isHighlightable` を再利用する。

```
finding = { "quote": <本文からの逐語引用・地の文>, "comment": <指摘>, "severity": "info"|"warn" }
```

### エンドポイント
`POST /api/documents/:id/review-threads`（members 限定・非ストリーミング）。
`runReviewAgent` を **finding モードのシステムプロンプト**（JSON 配列のみ・散文を逐語引用・不信任宣言）で実行し、
読み取り専用ツール（doc/workspace。repo は v1 では付けない）を渡す。最終 `text` を `parseFindings` し、各 finding を
スレッド化して返す（`{ created, skipped }`）。

### アンカー
- `anchorText` = `isHighlightable` なら**正規化した quote**（装飾を外した、レンダリング後に光る形）。光らない場合も
  raw quote をそのまま `anchorText` に入れる（パネル表示のみ＝degrade）。
- `anchorBefore` / `anchorAfter` = v1 では null（スパイクで曖昧 0＝引用は十分ユニーク。必要になれば描画後文脈を入れる）。

### AI 著者＝sentinel（migration 不要）
`threads.createdBy` / `comments.author` に `ai-review` を入れる（text 列・スキーマ変更なし）。
web は author が `ai-review` のとき「AI レビュー」バッジで表示する。

### 重複ポリシー
再実行のたびに**既存の `ai-review` かつ `open` のスレッドを削除**してから作り直す（最新の指摘で置換）。
人が `resolved` にしたものは残す。人間のスレッドには一切触れない。

### 通知・コスト
スレッドは DB へ直接 insert（コメント API を通さない）＝**mention 通知は出さない**（AI 指摘で通知洪水にしない）。
コストはレビュー 1 回相当。usage 永続化は v1 では省略（保存先 `reviews` 行を作らないため。必要なら fast-follow）。

## やらないこと（v1）/ fast-follow

| 項目 | v1 | 後追い |
|---|---|---|
| ハイライタの cross-node 化（インラインコードまたぎを光らせ inline 率 ~100% へ） | × | ◎ 最優先 fast-follow（`web/src/lib/highlight.ts`） |
| repo ツール（review-repo 相当）を finding 生成にも | × | 任意 |
| usage 永続化・SSE ストリーミング | × | 任意 |

## テスト

- scripted な converse が finding JSON を返す → 当該 doc に threads + comments が作られる。
- 再実行で `ai-review` の open スレが置換される（resolved・人間スレは残る）。
- 光らない引用（インラインコードまたぎ）でもスレッド自体は作られる（degrade）。
- パース不能・finding 0 件は `created:0` で 200（never throw）。
