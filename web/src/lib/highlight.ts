import type { Thread } from "../api/types";

// プレビュー DOM 内のテキストから、各スレッドのアンカー文字列を <mark> で包む。
// container.innerHTML は描画済み HTML が入っている前提（呼び出し側で毎回再設定する）。
// マッチは「単一テキストノード内に anchorText が含まれる最初の箇所」を採用（MVP）。
// pre/code 内と既存 mark 内はスキップ。
export function applyHighlights(
  container: HTMLElement,
  threads: Thread[],
  activeId: string | null,
): void {
  // open を先に、resolved も薄く出す（解決済みは淡色）。
  const ordered = [...threads].sort((a, b) =>
    a.status === b.status ? 0 : a.status === "open" ? -1 : 1,
  );
  for (const t of ordered) {
    wrapFirstMatch(container, t.anchorText, t.id, t.status, t.id === activeId);
  }
}

function wrapFirstMatch(
  container: HTMLElement,
  text: string,
  threadId: string,
  status: "open" | "resolved",
  active: boolean,
): void {
  const needle = (text ?? "").trim();
  if (!needle) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.includes(needle)) return NodeFilter.FILTER_REJECT;
      let p = node.parentElement;
      while (p && p !== container) {
        const tag = p.tagName;
        if (tag === "PRE" || tag === "CODE" || tag === "MARK") return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const node = walker.nextNode() as Text | null;
  if (!node || !node.nodeValue) return;

  const idx = node.nodeValue.indexOf(needle);
  const range = document.createRange();
  range.setStart(node, idx);
  range.setEnd(node, idx + needle.length);

  const mark = document.createElement("mark");
  mark.className =
    "comment-highlight" +
    (status === "resolved" ? " comment-highlight-resolved" : "") +
    (active ? " comment-highlight-active" : "");
  mark.dataset.threadId = threadId;
  try {
    range.surroundContents(mark);
  } catch {
    // 単一テキストノード内なので通常成功するが、念のため握りつぶす。
  }
}
