import { useMemo } from "react";
import { lineDiff } from "../lib/diff";

// 行単位差分の表示（追加=+/削除=−/文脈）。差分計算不能・差分なしは文言で伝える。
export function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = useMemo(() => lineDiff(oldText, newText), [oldText, newText]);
  if (rows === null) {
    return (
      <p className="p-3 text-sm text-slate-400">
        差分が大きすぎて表示できません。改稿案の全文で確認してください。
      </p>
    );
  }
  if (!rows.some((r) => r.t !== "ctx")) {
    return <p className="p-3 text-sm text-slate-400">元の本文との差分はありません。</p>;
  }
  return (
    <div className="diff-view">
      {rows.map((r, i) => (
        <div key={i} className={`diff-line diff-${r.t}`}>
          <span className="diff-sign">{r.t === "add" ? "+" : r.t === "del" ? "−" : " "}</span>
          <span>{r.text || " "}</span>
        </div>
      ))}
    </div>
  );
}
