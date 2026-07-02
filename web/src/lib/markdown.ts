import { marked } from "marked";
import DOMPurify from "dompurify";
// core + 主要言語のみの common ビルド（全言語版よりバンドルが軽い）
import hljs from "highlight.js/lib/common";

marked.setOptions({ gfm: true, breaks: false });

// Markdown → サニタイズ済み HTML。dangerouslySetInnerHTML に渡す前に必ず通す。
export function renderMarkdown(md: string): string {
  let src = md ?? "";
  // 表の直前行に置いた `<!-- 集計 -->`（または `<!-- summary -->`）マーカーで、
  // その表を合否集計の対象にオプトインする（旧 md-collab の「表の集計」#61）。
  // マーカー直後に空行を保証し、続く表が HTML コメントブロックに飲まれず表として parse されるようにする。
  src = src.replace(/^([ \t]*<!--\s*(?:summary|集計)\s*-->[ \t]*)\r?\n(?=[ \t]*\|)/gim, "$1\n\n");
  let raw = marked.parse(src, { async: false });
  // DOMPurify は HTML コメントを落とすので、サニタイズ前にオプトインを data 属性へ移す
  // （data-* はサニタイズを生き残る）。
  raw = raw.replace(/<!--\s*(?:summary|集計)\s*-->\s*<table/gi, '<table data-summary="1"');
  const clean = DOMPurify.sanitize(raw);
  return enhanceHtml(clean);
}

// サニタイズ済み HTML に対する DOM 後処理（表の集計 #61・構文ハイライト #63）。
// 対象要素が無ければ parse を省いてそのまま返す。
function enhanceHtml(html: string): string {
  const hasSummary = html.includes("data-summary");
  const hasCode = html.includes("<pre>");
  if (!hasSummary && !hasCode) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (hasSummary) enhanceSummaryTables(doc);
  if (hasCode) highlightCodeBlocks(doc);
  return doc.body.innerHTML;
}

// ─── コードブロックの構文ハイライト（#63） ──────────────────────────────────
// 言語指定付き（```ts など）のコードブロックだけをトークン色分けする。
// 言語なし・未知言語・mermaid（#62 で図として扱う）は素の等幅表示のまま。
// hljs.highlight はテキストを受け取り HTML エスケープ済みのマークアップを返すため、
// サニタイズ後の注入でも安全（入力は textContent 経由の生テキスト）。
function highlightCodeBlocks(doc: Document): void {
  doc.querySelectorAll('pre > code[class*="language-"]').forEach((code) => {
    const lang = [...code.classList]
      .find((c) => c.startsWith("language-"))
      ?.slice("language-".length);
    if (!lang || lang === "mermaid" || !hljs.getLanguage(lang)) return;
    const result = hljs.highlight(code.textContent ?? "", { language: lang });
    code.innerHTML = result.value;
    code.classList.add("hljs");
  });
}

// ─── 表の合否集計（#61） ─────────────────────────────────────────────────────
// ヘッダの部分一致で合否列と担当者列を特定する。大文字小文字は無視。
const SUMMARY_STATUS_RE = /(結果|判定|ステータス|状態|合否|チェック|status|result|pass|\bok\b)/i;
const SUMMARY_ASSIGNEE_RE = /(担当|責任|アサイン|assignee|owner)/i;

// セルのテキストが合格トークンなら true。
function isPassText(text: string | null): boolean {
  const t = (text ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return /^(ok|済|済み|合格|✓|✔|☑|\[x\])$/.test(t);
}

function getSummaryColumns(table: Element) {
  const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
  let statusIdx = headers.findIndex((h) => SUMMARY_STATUS_RE.test(h));
  const statusByKeyword = statusIdx !== -1;
  if (statusIdx === -1) statusIdx = headers.length - 1; // キーワード不一致なら最終列に縮退
  const assigneeIdx = headers.findIndex((h) => SUMMARY_ASSIGNEE_RE.test(h));
  return { headers, statusIdx, statusByKeyword, assigneeIdx };
}

// 合否セルの判定: チェックボックス（描画済み）が優先、無ければテキストで判定。
function cellIsPass(cell: Element | undefined): boolean {
  if (!cell) return false;
  const box = cell.querySelector<HTMLInputElement>('input[type="checkbox"]');
  return box ? box.checked : isPassText(cell.textContent);
}

// 合否列の `[x]` / `[ ]`（と、列がキーワード特定できた場合の空セル）を
// チェックボックス表示に置き換える。トグル永続化（段階2）までは常に disabled。
function renderStatusCheckboxes(doc: Document, table: Element): void {
  const { statusIdx, statusByKeyword } = getSummaryColumns(table);
  if (statusIdx < 0) return;
  table.querySelectorAll("tbody tr").forEach((tr) => {
    const cell = tr.querySelectorAll("td")[statusIdx];
    if (!cell || cell.querySelector("input")) return;
    const rawText = cell.textContent?.trim() ?? "";
    const m = /^\[([ xX])\]$/.exec(rawText);
    let checked: boolean;
    if (m) checked = m[1].toLowerCase() === "x";
    else if (rawText === "" && statusByKeyword) checked = false;
    else return; // テキスト値（OK / ✓ / 済 …）はそのまま
    const input = doc.createElement("input");
    input.type = "checkbox";
    input.className = "table-check";
    input.checked = checked;
    if (checked) input.setAttribute("checked", "");
    input.disabled = true;
    cell.textContent = "";
    cell.classList.add("table-check-cell");
    cell.appendChild(input);
  });
}

function buildTableSummary(doc: Document, table: Element): Element | null {
  if (!table.querySelector("thead th")) return null;
  const { statusIdx, assigneeIdx } = getSummaryColumns(table);

  let total = 0;
  let pass = 0;
  const groups = new Map<string, { total: number; pass: number }>(); // 挿入順 = 出現順
  table.querySelectorAll("tbody tr").forEach((tr) => {
    const cells = tr.querySelectorAll("td");
    if (!cells.length) return;
    total++;
    const ok = cellIsPass(cells[statusIdx]) ? 1 : 0;
    pass += ok;
    if (assigneeIdx >= 0) {
      const who = cells[assigneeIdx]?.textContent?.trim() || "(未割当)";
      const g = groups.get(who) ?? { total: 0, pass: 0 };
      g.total++;
      g.pass += ok;
      groups.set(who, g);
    }
  });
  if (total === 0) return null;

  const pct = (p: number, t: number) => {
    const v = t ? (p / t) * 100 : 0;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };
  const fmt = (p: number, t: number) => `${p}/${t} 件 (${pct(p, t)}%)`;

  // textContent で組み立てるので担当者名のエスケープは不要（HTML 注入を防ぐ）。
  const div = doc.createElement("div");
  div.className = "table-summary";
  const label = doc.createElement("span");
  label.className = "table-summary-label";
  label.textContent = "全体:";
  div.append(label, ` ${fmt(pass, total)}`);
  if (groups.size) {
    const by = doc.createElement("span");
    by.className = "table-summary-by";
    by.textContent = `担当者別 — ${[...groups.entries()]
      .map(([who, g]) => `${who}: ${fmt(g.pass, g.total)}`)
      .join(" ／ ")}`;
    div.append(doc.createElement("br"), by);
  }
  return div;
}

// 集計対象の表へチェックボックス表示と集計ブロック（表直下）を注入する。
function enhanceSummaryTables(doc: Document): void {
  doc.querySelectorAll("table[data-summary]").forEach((table) => {
    renderStatusCheckboxes(doc, table);
    const summary = buildTableSummary(doc, table);
    if (summary) table.insertAdjacentElement("afterend", summary);
  });
}
