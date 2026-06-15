import type { Thread } from "../api/types";

// プレビュー DOM 内のテキストから、各スレッドのアンカー文字列を <mark> で包む。
// container.innerHTML は描画済み HTML が入っている前提（呼び出し側で毎回再設定する）。
//
// cross-node 対応: アンカーはインラインコード（`x`）・強調・リンクをまたぐことがある。描画後は
// それらが <code>/<strong>/<a> で別テキストノードに分かれるため、ブロック要素（p/li/td/見出し等）
// ごとにテキストノードを連結して一致を取り、一致範囲を構成する各テキストノードを個別に <mark> で包む
// （複数 mark で 1 つの下線を表現・どれをクリックしても同じ thread にフォーカス）。
// 同じ文字列が複数ある場合は anchorBefore/After で最良の出現箇所を選ぶ。pre（コードブロック）と
// 既存 mark 内はスキップ。本文編集への追従まではしない（軽量版）。

const BLOCK = new Set([
  "P", "LI", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "DD", "DT", "FIGCAPTION", "DIV", "SECTION", "ARTICLE", "DETAILS", "SUMMARY",
]);

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

// 1 テキストノードが連結文字列のどの範囲を占めるか。
interface Seg {
  node: Text;
  start: number;
  end: number;
}
// 同一ブロック内のテキストノードを連結した文字列とノード対応表。
interface Group {
  text: string;
  segs: Seg[];
}

// node と container の間に pre / 既存 mark があればスキップ対象。
function isSkipped(node: Node, container: HTMLElement): boolean {
  let p = node.parentElement;
  while (p && p !== container) {
    if (p.tagName === "PRE" || p.tagName === "MARK") return true;
    p = p.parentElement;
  }
  return false;
}

// node が属する最も近いブロック要素（無ければ container）。インライン境界はこの中で溶ける。
function blockOf(node: Node, container: HTMLElement): Element {
  let p = node.parentElement;
  while (p && p !== container) {
    if (BLOCK.has(p.tagName)) return p;
    p = p.parentElement;
  }
  return container;
}

// container 内のテキストノードを、ブロックごとに連結した Group の配列へ集約する。
function collectGroups(container: HTMLElement): Group[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const byBlock = new Map<Element, Group>();
  const order: Group[] = [];
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!n.nodeValue || isSkipped(n, container)) continue;
    const block = blockOf(n, container);
    let g = byBlock.get(block);
    if (!g) {
      g = { text: "", segs: [] };
      byBlock.set(block, g);
      order.push(g);
    }
    const start = g.text.length;
    g.text += n.nodeValue;
    g.segs.push({ node: n, start, end: g.text.length });
  }
  return order;
}

function wrapBestMatch(container: HTMLElement, thread: Thread, active: boolean): void {
  const needle = (thread.anchorText ?? "").trim();
  if (!needle) return;
  const before = thread.anchorBefore ?? "";
  const after = thread.anchorAfter ?? "";

  // ブロック連結文字列ごとに出現を探し、前後文脈の一致長でスコアリングして最良を選ぶ。
  let best: { group: Group; idx: number; score: number } | null = null;
  for (const g of collectGroups(container)) {
    let from = 0;
    let idx: number;
    while ((idx = g.text.indexOf(needle, from)) !== -1) {
      const beforeLocal = g.text.slice(Math.max(0, idx - 40), idx);
      const afterLocal = g.text.slice(idx + needle.length, idx + needle.length + 40);
      const score = suffixOverlap(beforeLocal, before) + prefixOverlap(afterLocal, after);
      if (!best || score > best.score) best = { group: g, idx, score };
      from = idx + needle.length;
    }
  }
  if (!best) return;

  const start = best.idx;
  const end = best.idx + needle.length;
  const className =
    "comment-highlight" +
    (thread.status === "resolved" ? " comment-highlight-resolved" : "") +
    (active ? " comment-highlight-active" : "");

  // 一致範囲が重なる各テキストノードの部分範囲を先に集めてから包む
  // （包むと DOM が変わるが、対象ノードは互いに独立なので順不同で安全）。
  const targets: { node: Text; ls: number; le: number }[] = [];
  for (const seg of best.group.segs) {
    const os = Math.max(start, seg.start);
    const oe = Math.min(end, seg.end);
    if (os < oe) targets.push({ node: seg.node, ls: os - seg.start, le: oe - seg.start });
  }
  for (const t of targets) {
    const range = document.createRange();
    range.setStart(t.node, t.ls);
    range.setEnd(t.node, t.le);
    const mark = document.createElement("mark");
    mark.className = className;
    mark.dataset.threadId = thread.id;
    try {
      range.surroundContents(mark);
    } catch {
      // 単一テキストノード内の範囲なので通常成功するが、念のため握りつぶす。
    }
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
