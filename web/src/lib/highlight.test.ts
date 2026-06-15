import { describe, expect, it } from "vitest";
import { applyHighlights } from "./highlight";
import type { Thread } from "../api/types";

function thread(over: Partial<Thread>): Thread {
  return {
    id: "t1",
    documentId: "d1",
    status: "open",
    anchorText: "",
    anchorBefore: "",
    anchorAfter: "",
    createdBy: "u",
    createdAt: "2026-01-01T00:00:00Z",
    resolvedBy: null,
    resolvedAt: null,
    comments: [],
    ...over,
  };
}

function container(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("applyHighlights", () => {
  it("アンカー文字列を <mark data-thread-id> で包む", () => {
    const el = container("<p>foo bar baz</p>");
    applyHighlights(el, [thread({ id: "T", anchorText: "bar" })], null);
    const mark = el.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("bar");
    expect(mark!.dataset.threadId).toBe("T");
  });

  it("active なスレッドには comment-highlight-active を付ける", () => {
    const el = container("<p>alpha beta</p>");
    applyHighlights(el, [thread({ id: "A", anchorText: "beta" })], "A");
    expect(el.querySelector("mark")!.className).toContain("comment-highlight-active");
  });

  it("resolved は淡色クラスを付ける", () => {
    const el = container("<p>done text</p>");
    applyHighlights(el, [thread({ id: "R", anchorText: "done", status: "resolved" })], null);
    expect(el.querySelector("mark")!.className).toContain("comment-highlight-resolved");
  });

  it("同じ文字列が複数あるとき、前後文脈が最も一致する出現箇所を選ぶ", () => {
    // "cat" が2回。2つ目を anchorBefore="big " / anchorAfter=" sat" で狙う。
    const el = container("<p>a cat ran. a big cat sat.</p>");
    applyHighlights(
      el,
      [thread({ id: "C", anchorText: "cat", anchorBefore: "big ", anchorAfter: " sat" })],
      null,
    );
    const marks = el.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    // 2つ目（"big cat sat"）が選ばれている＝直前テキストが "big "
    const mark = marks[0]!;
    expect(mark.previousSibling?.textContent?.endsWith("big ")).toBe(true);
  });

  it("pre/code 内のアンカーはスキップする", () => {
    const el = container("<pre><code>needle</code></pre><p>needle</p>");
    applyHighlights(el, [thread({ id: "S", anchorText: "needle" })], null);
    const mark = el.querySelector("mark");
    // code 内ではなく <p> 内が包まれる
    expect(mark).not.toBeNull();
    expect(mark!.closest("pre")).toBeNull();
  });

  it("cross-node: インラインコードをまたぐアンカーを複数 mark で包む", () => {
    // 描画後は "PAT は " + <code>ai_keys</code> + " に保存" の 3 テキストノード。
    const el = container("<p>PAT は <code>ai_keys</code> に保存する</p>");
    applyHighlights(el, [thread({ id: "X", anchorText: "ai_keys に保存" })], null);
    const marks = el.querySelectorAll('mark[data-thread-id="X"]');
    expect(marks.length).toBeGreaterThanOrEqual(2); // 複数ノードにまたがって包まれる
    // 包まれた断片を連結すると元のアンカーになる
    const joined = Array.from(marks)
      .map((m) => m.textContent)
      .join("");
    expect(joined).toBe("ai_keys に保存");
    // コード内の断片も mark で包まれている
    expect(el.querySelector("code mark")).not.toBeNull();
  });

  it("ブロックをまたぐ誤一致はしない（段落境界で連結しない）", () => {
    const el = container("<p>foo</p><p>bar</p>");
    applyHighlights(el, [thread({ id: "B", anchorText: "foobar" })], null);
    expect(el.querySelector("mark")).toBeNull();
  });

  it("空アンカー / 不一致は何もしない", () => {
    const el = container("<p>hello</p>");
    applyHighlights(el, [thread({ anchorText: "" }), thread({ anchorText: "zzz" })], null);
    expect(el.querySelector("mark")).toBeNull();
  });
});
