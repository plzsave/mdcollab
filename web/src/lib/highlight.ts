import type { Thread } from "../api/types";

// プレビュー DOM 内のテキストから、各スレッドのアンカー文字列を <mark> で包む。
// container.innerHTML は描画済み HTML が入っている前提（呼び出し側で毎回再設定する）。
// 同じ文字列が複数ある場合の取り違えを減らすため、anchorBefore/After（作成時の前後文脈）
// との一致度で最良の出現箇所を選ぶ（軽量版・本文編集への追従まではしない）。
// pre/code 内と既存 mark 内はスキップ。マッチは単一テキストノード内のみ対象。
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
    wrapBestMatch(container, t, t.id === activeId);
  }
}

interface Candidate {
  node: Text;
  idx: number;
  score: number;
}

function wrapBestMatch(container: HTMLElement, thread: Thread, active: boolean): void {
  const needle = (thread.anchorText ?? "").trim();
  if (!needle) return;
  const before = thread.anchorBefore ?? "";
  const after = thread.anchorAfter ?? "";

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

  // 候補（テキストノード × 出現位置）を集め、前後文脈の一致長でスコアリング。
  let best: Candidate | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const text = node.nodeValue!;
    let from = 0;
    let idx: number;
    while ((idx = text.indexOf(needle, from)) !== -1) {
      const beforeLocal = text.slice(Math.max(0, idx - 40), idx);
      const afterLocal = text.slice(idx + needle.length, idx + needle.length + 40);
      const score = suffixOverlap(beforeLocal, before) + prefixOverlap(afterLocal, after);
      if (!best || score > best.score) best = { node, idx, score };
      from = idx + needle.length;
    }
  }
  if (!best) return;

  const range = document.createRange();
  range.setStart(best.node, best.idx);
  range.setEnd(best.node, best.idx + needle.length);

  const mark = document.createElement("mark");
  mark.className =
    "comment-highlight" +
    (thread.status === "resolved" ? " comment-highlight-resolved" : "") +
    (active ? " comment-highlight-active" : "");
  mark.dataset.threadId = thread.id;
  try {
    range.surroundContents(mark);
  } catch {
    // 単一テキストノード内なので通常成功するが、念のため握りつぶす。
  }
}

// a の末尾と b の末尾がどれだけ一致するか（前文脈は「マッチ直前」が手がかりなので末尾比較）。
function suffixOverlap(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

// a の先頭と b の先頭がどれだけ一致するか（後文脈は「マッチ直後」が手がかり）。
function prefixOverlap(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
