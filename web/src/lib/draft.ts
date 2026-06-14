// 編集中の本文を localStorage に退避する下書きストア（#22）。
// タブを閉じる/クラッシュ時の編集消失を防ぐ。保存成功・破棄時にクリアする。

const PREFIX = "mdcollab:draft:";

export type Draft = { content: string; baseVersion: number; savedAt: number };

function keyOf(docId: string): string {
  return PREFIX + docId;
}

export function loadDraft(docId: string): Draft | null {
  try {
    const raw = localStorage.getItem(keyOf(docId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (typeof d?.content !== "string") return null;
    return d;
  } catch {
    return null;
  }
}

export function saveDraft(docId: string, draft: Draft): void {
  try {
    localStorage.setItem(keyOf(docId), JSON.stringify(draft));
  } catch {
    /* QuotaExceeded 等は無視（下書きはベストエフォート） */
  }
}

export function clearDraft(docId: string): void {
  try {
    localStorage.removeItem(keyOf(docId));
  } catch {
    /* ignore */
  }
}
