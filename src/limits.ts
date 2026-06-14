// 入力サイズ上限（#8 / セキュリティレビュー G）。
// members 限定でリスクは低いが、明示的な上限を設けて超過時は 413/400 を返し、
// 巨大入力による DB/ストア/LLM コスト増や事故を防ぐ。

export const LIMITS = {
  // リクエストボディ総量。これを超えたら bodyLimit ミドルウェアが 413 を返す（粗い DoS バックストップ）。
  // 個別フィールド上限の UTF-8 最悪ケース + JSON オーバーヘッド + 一括インポートを十分にカバーする値。
  bodyBytes: 12 * 1024 * 1024,

  // フィールド別の最大「文字数」（超過は 400 BAD_REQUEST）。
  docContent: 1_000_000, // 本文（Markdown）。~1M 文字 ≈ 1MB ASCII
  title: 500,
  folderName: 200,
  commentBody: 50_000,
  anchorText: 4_000,
  anchorContext: 4_000, // anchorBefore / anchorAfter
} as const;

// [値, 上限, 名前] の組を検査し、超過があれば最初のエラーメッセージを返す（無ければ null）。
// 文字列でない値はスキップ（必須・型チェックは各ハンドラの既存ロジックに任せる）。
export function lengthError(checks: [unknown, number, string][]): string | null {
  for (const [value, max, name] of checks) {
    if (typeof value === "string" && value.length > max) {
      return `${name} too long (max ${max} chars)`;
    }
  }
  return null;
}
