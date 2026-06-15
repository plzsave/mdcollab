import { describe, it, expect } from "vitest";
import { anchorQuote, isHighlightable, parseFindings, renderedSegments } from "../src/ai/findings";

// ① スパイク: アンカー解決と finding パースの決定的ユニット（実モデルなし）。
// 当たり率の実測は scripts/eval-anchor.ts（手動・BYO-key）で行う。

describe("anchorQuote", () => {
  const doc = "# 見出し\n本文の最初の段落です。ここに重要な仕様があります。\n次の段落も続きます。";

  it("exact: 逐語一致でスパンと前後文脈を返す", () => {
    const r = anchorQuote(doc, "重要な仕様")!;
    expect(r.kind).toBe("exact");
    expect(r.anchorText).toBe("重要な仕様");
    expect(r.anchorBefore.endsWith("ここに")).toBe(true);
    expect(r.anchorAfter.startsWith("があります")).toBe(true);
  });

  it("端の空白差は exact 扱いで吸収（anchorText は trim 後）", () => {
    const r = anchorQuote(doc, "  重要な仕様  ")!;
    expect(r.kind).toBe("exact");
    expect(r.anchorText).toBe("重要な仕様");
  });

  it("normalized: 内部の空白/改行差を吸収し、本文側の実スパンを返す", () => {
    const src = "API は 成功時に 200 を返す"; // 本文側
    // quote は改行や連続スペースで揺れている
    const r = anchorQuote(src, "API は\n成功時に   200")!;
    expect(r.kind).toBe("normalized");
    expect(r.anchorText).toBe("API は 成功時に 200"); // 本文の実文字列（indexOf でも当たる）
    expect(src.includes(r.anchorText)).toBe(true);
  });

  it("正規表現メタ文字を含む引用もリテラル一致する", () => {
    const src = "式 f(x) = y+1 を評価する";
    const r = anchorQuote(src, "f(x) = y+1")!;
    expect(r.anchorText).toBe("f(x) = y+1");
  });

  it("見つからなければ null（never throw）", () => {
    expect(anchorQuote(doc, "存在しない語")).toBeNull();
    expect(anchorQuote(doc, "   ")).toBeNull();
  });

  it("ambiguous: 同一スパンが複数あると true", () => {
    const src = "猫 と 犬 と 猫";
    expect(anchorQuote(src, "猫")!.ambiguous).toBe(true);
    expect(anchorQuote(src, "犬")!.ambiguous).toBe(false);
  });
});

describe("parseFindings", () => {
  it("素の JSON 配列をパースする", () => {
    const out = parseFindings('[{"quote":"a","comment":"b","severity":"warn"}]');
    expect(out).toEqual([{ quote: "a", comment: "b", severity: "warn" }]);
  });

  it("コードフェンス/前後の説明があっても救済する", () => {
    const raw = 'はい、指摘です:\n```json\n[{"quote":"x","comment":"y"}]\n```\n以上です。';
    expect(parseFindings(raw)).toEqual([{ quote: "x", comment: "y" }]);
  });

  it("不正な要素は捨てる（quote/comment が文字列のものだけ）", () => {
    const raw = '[{"quote":"a","comment":"b"},{"comment":"no quote"},{"quote":1,"comment":"x"}]';
    expect(parseFindings(raw)).toEqual([{ quote: "a", comment: "b" }]);
  });

  it("JSON でなければ空配列", () => {
    expect(parseFindings("ただの文章です")).toEqual([]);
  });
});

describe("renderedSegments / isHighlightable（描画後ハイライト可能性）", () => {
  it("地の文の散文は単一素片＝ハイライト可能", () => {
    const md = "# 見出し\n\nIssue 作成にレート制限は設けない。GitHub 側の制限に任せる。\n";
    expect(isHighlightable(md, "Issue 作成にレート制限は設けない")).toBe(true);
  });

  it("インラインコードをまたぐ引用は不可（CODE ノードで分断）", () => {
    const md = "PAT は `ai_keys` テーブルに平文で保存し利用する。";
    expect(isHighlightable(md, "ai_keys` テーブルに平文で保存")).toBe(false);
    // コードの後ろの地の文だけなら可
    expect(isHighlightable(md, "テーブルに平文で保存し利用する")).toBe(true);
  });

  it("強調をまたぐ引用は不可", () => {
    const md = "- **Phase 2**: スレッド → issue コメント同期\n";
    expect(isHighlightable(md, "Phase 2**: スレッド")).toBe(false);
    expect(isHighlightable(md, "スレッド → issue コメント同期")).toBe(true);
  });

  it("表: 単一セルの中身は可・行（縦棒）またぎは不可", () => {
    const md = "| メソッド | パス |\n|---|---|\n| POST | `/api/x` |\n| 404 | UNAUTHORIZED |\n";
    expect(isHighlightable(md, "UNAUTHORIZED")).toBe(true); // セル内
    expect(isHighlightable(md, "404 | UNAUTHORIZED")).toBe(false); // 縦棒またぎ
  });

  it("コードフェンス内は対象外", () => {
    const md = "説明文。\n\n```json\n{ \"doc_id\": \"x\" }\n```\n";
    expect(isHighlightable(md, "doc_id")).toBe(false);
    expect(isHighlightable(md, "説明文")).toBe(true);
  });

  it("renderedSegments は装飾を外した素片を返す", () => {
    expect(renderedSegments("**太字** と普通")).toContain("太字");
    expect(renderedSegments("詳細は [リンク](http://x) を参照")).toContain("リンク");
  });
});
