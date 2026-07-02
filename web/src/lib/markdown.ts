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
  // CSP の style-src は mermaid のために 'unsafe-inline' を許しているので（web/public/_headers）、
  // ユーザー Markdown 由来の <style> と style 属性はここで明示的に落とし、CSS 注入経路を塞ぐ。
  const clean = DOMPurify.sanitize(raw, { FORBID_TAGS: ["style"], FORBID_ATTR: ["style"] });
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
    // 既定は表示専用。エディタのプレビューだけが後段で有効化してトグルを本文へ書き戻す（段階2）。
    input.disabled = true;
    input.dataset.col = String(statusIdx);
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
// data-summary-index（集計表の出現順）はソース側の表とトグルを対応付けるのに使う（段階2）。
function enhanceSummaryTables(doc: Document): void {
  doc.querySelectorAll("table[data-summary]").forEach((table, idx) => {
    table.setAttribute("data-summary-index", String(idx));
    renderStatusCheckboxes(doc, table);
    const summary = buildTableSummary(doc, table);
    if (summary) table.insertAdjacentElement("afterend", summary);
  });
}

// ─── 段階2: プレビューのチェックボックス・トグルを Markdown ソースへ書き戻す ──
// DOM 側の「N 番目の集計表・行 r・列 c」を、ソース行の該当セルに対応付けて
// `[x]` / `[ ]` トークンだけを書き換える（他の整形は保持）。

// ソース中の各集計表（マーカー付き）の本文行レンジを出現順に列挙する。
// 出現順 = DOM の table[data-summary] の順序（renderMarkdown が同じソースから作るため）。
function locateSummaryTables(lines: string[]): { bodyStart: number; bodyEnd: number }[] {
  const markerRe = /^[ \t]*<!--\s*(?:summary|集計)\s*-->[ \t]*$/i;
  const rowRe = /^[ \t]*\|.*\|[ \t]*$/;
  const isDelim = (l: string) => rowRe.test(l) && /^[\s|:\-]+$/.test(l) && l.includes("-");
  const tables: { bodyStart: number; bodyEnd: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!markerRe.test(lines[i]!)) continue;
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++; // 空行スキップ
    if (j >= lines.length || !rowRe.test(lines[j]!)) continue; // ヘッダ行
    if (j + 1 >= lines.length || !isDelim(lines[j + 1]!)) continue; // 区切り行
    let k = j + 2;
    const bodyStart = k;
    while (k < lines.length && rowRe.test(lines[k]!) && !isDelim(lines[k]!)) k++;
    tables.push({ bodyStart, bodyEnd: k });
  }
  return tables;
}

// 表行の内側セル colIndex（0 始まり）のブラケットトークンだけを書き換える。
// セルが空なら新規にトークンを差し込む。書き換え不能（テキスト値等）なら null。
function toggleCellInLine(line: string, colIndex: number, makeChecked: boolean): string | null {
  const pieces = line.split("|"); // 行は前後にパイプを持つ → 内側セル k は pieces[k+1]
  const target = colIndex + 1;
  if (target < 1 || target >= pieces.length - 1) return null;
  const cell = pieces[target]!;
  const token = makeChecked ? "[x]" : "[ ]";
  if (/\[[ xX]\]/.test(cell)) pieces[target] = cell.replace(/\[[ xX]\]/, token);
  else if (cell.trim() === "") pieces[target] = ` ${token} `;
  else return null;
  return pieces.join("|");
}

/** プレビューのトグル（tableIndex 番目の集計表・行 rowIndex・列 colIndex）を
 *  ソースへ反映した新しい本文を返す。対応付けに失敗したら null（呼び出し側で巻き戻す）。 */
export function toggleSummaryCheckboxInSource(
  src: string,
  tableIndex: number,
  rowIndex: number,
  colIndex: number,
  checked: boolean,
): string | null {
  const lines = (src ?? "").split("\n");
  const t = locateSummaryTables(lines)[tableIndex];
  if (!t || rowIndex < 0) return null;
  const lineNo = t.bodyStart + rowIndex;
  if (lineNo >= t.bodyEnd) return null;
  const updated = toggleCellInLine(lines[lineNo]!, colIndex, checked);
  if (updated === null) return null;
  lines[lineNo] = updated;
  return lines.join("\n");
}
