import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("GFM の見出し・リストを HTML 化する", () => {
    const html = renderMarkdown("# Title\n\n- a\n- b");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<li>a</li>");
  });

  it("script タグを除去する（XSS サニタイズ）", () => {
    const html = renderMarkdown("hello <script>alert(1)</script> world");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });

  it("onerror などのイベントハンドラ属性を除去する", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("javascript: スキームのリンクを無害化する", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:alert(1)");
  });

  it("null/undefined 入力でも例外を投げず空文字を返す", () => {
    expect(renderMarkdown(null as unknown as string)).toBe("");
    expect(renderMarkdown(undefined as unknown as string)).toBe("");
  });
});

// #61 表の集計: <!-- 集計 --> マーカー付き表の直下に合否サマリを出す
describe("renderMarkdown: 表の集計（<!-- 集計 -->）", () => {
  const parse = (md: string) => {
    const div = document.createElement("div");
    div.innerHTML = renderMarkdown(md);
    return div;
  };
  const summaryText = (div: HTMLElement) =>
    div.querySelector(".table-summary")?.textContent ?? null;

  it("マーカー付き表に全体の合否件数・割合が出る", () => {
    const div = parse(
      [
        "<!-- 集計 -->",
        "| 項目 | 結果 |",
        "| --- | --- |",
        "| a | OK |",
        "| b | NG |",
      ].join("\n"),
    );
    expect(div.querySelector("table + .table-summary")).not.toBeNull();
    expect(summaryText(div)).toContain("全体: 1/2 件 (50%)");
  });

  it("英語マーカー <!-- summary --> と、マーカー後の空行ありでも効く", () => {
    const div = parse(
      ["<!-- summary -->", "", "| 項目 | 結果 |", "| --- | --- |", "| a | OK |"].join("\n"),
    );
    expect(summaryText(div)).toContain("全体: 1/1 件 (100%)");
  });

  it("担当者列があると担当者別の件数・割合が出る（出現順・割り切れない率は小数1桁）", () => {
    const div = parse(
      [
        "<!-- 集計 -->",
        "| 項目 | 担当 | 結果 |",
        "| --- | --- | --- |",
        "| a | 山田 | OK |",
        "| b | 山田 | OK |",
        "| c | 山田 | NG |",
        "| d | 佐藤 | OK |",
        "| e |  | NG |",
      ].join("\n"),
    );
    const t = summaryText(div) ?? "";
    expect(t).toContain("全体: 3/5 件 (60%)");
    expect(t).toContain("担当者別 — 山田: 2/3 件 (66.7%) ／ 佐藤: 1/1 件 (100%) ／ (未割当): 0/1 件 (0%)");
  });

  it("旧実装の合格トークン（OK/✓/済/合格/[x]）を pass と数え、それ以外は数えない", () => {
    const div = parse(
      [
        "<!-- 集計 -->",
        "| 項目 | 結果 |",
        "| --- | --- |",
        "| a | ok |",
        "| b | ✓ |",
        "| c | 済 |",
        "| d | 合格 |",
        "| e | [x] |",
        "| f | NG |",
        "| g | 保留 |",
        "| h |  |",
      ].join("\n"),
    );
    expect(summaryText(div)).toContain("全体: 5/8 件 (62.5%)");
  });

  it("[x]/[ ] セルは disabled チェックボックス表示になり集計にも乗る", () => {
    const div = parse(
      [
        "<!-- 集計 -->",
        "| 項目 | チェック |",
        "| --- | --- |",
        "| a | [x] |",
        "| b | [ ] |",
      ].join("\n"),
    );
    const boxes = div.querySelectorAll<HTMLInputElement>("td input[type=checkbox]");
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
    expect([...boxes].every((b) => b.disabled)).toBe(true);
    expect(summaryText(div)).toContain("全体: 1/2 件 (50%)");
  });

  it("合否キーワードのヘッダが無い場合は最終列で集計する（旧実装の縮退仕様）", () => {
    const div = parse(
      ["<!-- 集計 -->", "| 項目 | メモ |", "| --- | --- |", "| a | OK |", "| b | 未 |"].join("\n"),
    );
    expect(summaryText(div)).toContain("全体: 1/2 件 (50%)");
  });

  it("マーカーの無い表はそのまま（集計もチェックボックスも出ない）", () => {
    const div = parse(
      ["| 項目 | 結果 |", "| --- | --- |", "| a | [x] |", "| b | NG |"].join("\n"),
    );
    expect(div.querySelector("table")).not.toBeNull();
    expect(div.querySelector(".table-summary")).toBeNull();
    expect(div.querySelector("td input")).toBeNull();
  });

  it("担当者名に HTML が入っていてもサニタイズ済みで注入されない", () => {
    const div = parse(
      [
        "<!-- 集計 -->",
        "| 項目 | 担当 | 結果 |",
        "| --- | --- | --- |",
        '| a | <img src=x onerror="alert(1)"> | OK |',
      ].join("\n"),
    );
    expect(div.innerHTML).not.toContain("onerror");
    expect(div.querySelector(".table-summary img")).toBeNull();
  });
});
