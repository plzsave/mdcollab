// ① 指摘のコメントスレッド化のためのスパイク基盤（純粋・テスト可能）。
// AI レビューの指摘を「本文の該当箇所にアンカーした構造化 finding」にするには、
// モデルが本文から逐語引用した quote を、本文中の実スパンに対応づけられる必要がある。
// その当たり率（exact / 空白正規化 / 失敗）を測るためのロジックをここに閉じ込める。
//
// 注（既存スレッドとの整合）: web のハイライト（web/src/lib/highlight.ts）は anchorText を
// レンダリング後テキストへ indexOf で当てる。よって最終的にはレンダリング後テキストを
// haystack にするのが忠実。本スパイクはまず「モデルが逐語スパンを再現できるか」を測るのが
// 目的なので、呼び出し側が渡す任意の haystack（生 Markdown でもレンダリング後でも）に対して
// 汎用に動く。

export interface Finding {
  /** 本文からの逐語引用（アンカー対象）。 */
  quote: string;
  /** 指摘内容。 */
  comment: string;
  /** 任意の重要度。 */
  severity?: string;
}

export type AnchorKind = "exact" | "normalized";

export interface AnchorResult {
  /** haystack 中に実在するスパン（= web の indexOf でも当たる文字列）。 */
  anchorText: string;
  anchorBefore: string;
  anchorAfter: string;
  kind: AnchorKind;
  /** 同一スパンが複数あり取り違えうるか（曖昧さの指標）。 */
  ambiguous: boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// モデル出力（JSON 配列・前後に説明やコードフェンスが付くことがある）から finding 配列を取り出す。
// 厳密 JSON でなくても、最初の '[' から最後の ']' を切り出して救済する。never throw。
export function parseFindings(raw: string): Finding[] {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let parsed = tryParse(raw);
  if (!Array.isArray(parsed)) {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start >= 0 && end > start) parsed = tryParse(raw.slice(start, end + 1));
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (o): o is { quote: string; comment: string; severity?: unknown } =>
        !!o && typeof o === "object" && typeof o.quote === "string" && typeof o.comment === "string",
    )
    .map((o) => ({
      quote: o.quote,
      comment: o.comment,
      ...(typeof o.severity === "string" ? { severity: o.severity } : {}),
    }));
}

// haystack 中で quote の位置を解決し、実スパン（anchorText）と前後文脈を返す。
// exact（生→trim）→ 空白正規化（連続空白を \s+ 扱いの正規表現）の順。見つからなければ null。
export function anchorQuote(haystack: string, quote: string, ctx = 40): AnchorResult | null {
  const q = quote.trim();
  if (!q) return null;

  let idx = haystack.indexOf(quote);
  let len = quote.length;
  let kind: AnchorKind = "exact";

  if (idx < 0) {
    idx = haystack.indexOf(q); // 端の空白だけ違うケース
    if (idx >= 0) len = q.length;
  }
  if (idx < 0) {
    // 内部の空白（改行↔スペース等）の差を吸収して、本文側の実スパンを取り出す。
    const pattern = q.split(/\s+/).map(escapeRegex).join("\\s+");
    const m = new RegExp(pattern).exec(haystack);
    if (m) {
      idx = m.index;
      len = m[0].length;
      kind = "normalized";
    }
  }
  if (idx < 0) return null;

  const anchorText = haystack.slice(idx, idx + len);
  return {
    anchorText,
    anchorBefore: haystack.slice(Math.max(0, idx - ctx), idx),
    anchorAfter: haystack.slice(idx + len, idx + len + ctx),
    kind,
    ambiguous: haystack.indexOf(anchorText) !== haystack.lastIndexOf(anchorText),
  };
}
