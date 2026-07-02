// #64: 行単位の LCS 差分（AI 改稿案の反映前確認用）。
// 入力は改稿 API の上限で抑えられている前提だが、病的な行数で O(n*m) の
// テーブルが膨れる場合は null を返して呼び出し側でフォールバック表示する。

export type DiffRow = { t: "add" | "del" | "ctx"; text: string };

export function lineDiff(oldText: string, newText: string): DiffRow[] | null {
  const a = (oldText ?? "").split("\n");
  const b = (newText ?? "").split("\n");
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > 4_000_000) return null; // 差分表を安価に持てないサイズ
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ t: "ctx", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ t: "del", text: a[i]! });
      i++;
    } else {
      rows.push({ t: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) rows.push({ t: "del", text: a[i++]! });
  while (j < m) rows.push({ t: "add", text: b[j++]! });
  return rows;
}
