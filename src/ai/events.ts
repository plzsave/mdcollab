import type { Deps } from "../env";
import { aiReviewEvents } from "../db/schema";

// AI レビュー機能の運用イベント追記（Tier 1）。本文は一切含めない＝content-free。
// 採用率・ノイズ率の母数を正確にするための信号を貯める。

// AI 著者の sentinel（threads.createdBy / comments.author）。web は「🤖 AI レビュー」表示。
export const AI_THREAD_AUTHOR = "ai-review";

export type AiReviewAction =
  | "threads_created"
  | "threads_superseded"
  | "thread_resolved"
  // 保存済みモデルの退役等で代替モデルにフォールバックした（#81。「設定が古い」検知の信号）
  | "model_fallback"
  // truncated（上限到達）を昇格先モデルで救済再実行した（#84。頻発するなら基本モデル/上限の見直し信号）
  | "model_escalated";

// 追記は可観測性のための副作用。失敗しても本処理を止めない（never throw）。
export async function recordAiEvent(
  deps: Deps,
  e: { documentId: string; actor: string; action: AiReviewAction; count?: number },
): Promise<void> {
  try {
    await deps.db.insert(aiReviewEvents).values({
      id: crypto.randomUUID(),
      documentId: e.documentId,
      actor: e.actor,
      action: e.action,
      count: e.count ?? null,
    });
  } catch {
    /* 計測の失敗でユーザー操作を壊さない */
  }
}
