import { inArray } from "drizzle-orm";
import type { Deps } from "./env";
import { notifications, members } from "./db/schema";

// 通知の副作用発火を1か所に集約（移行計画 横断機能B）。
// mention / reply / resolve などで recipients にレコードを積む。

export interface NotifyInput {
  type: string; // "mention" | "reply" | "resolve" など
  recipients: string[];
  actor?: string; // 発火させた本人は除外（自分への通知を作らない）
  threadId?: string;
  commentId?: string;
  documentId?: string;
  documentName?: string;
  message?: string;
}

/** recipients から actor と重複を除いて通知行を挿入する（0件なら何もしない）。 */
export async function notify(deps: Deps, input: NotifyInput): Promise<string[]> {
  const set = new Set(input.recipients.filter((e) => typeof e === "string" && e.length > 0));
  if (input.actor) set.delete(input.actor);
  const targets = [...set];
  if (targets.length === 0) return [];

  await deps.db.insert(notifications).values(
    targets.map((recipient) => ({
      id: crypto.randomUUID(),
      recipient,
      type: input.type,
      threadId: input.threadId ?? null,
      commentId: input.commentId ?? null,
      documentId: input.documentId ?? null,
      documentName: input.documentName ?? null,
      message: input.message ?? null,
    })),
  );
  return targets;
}

/** 与えた email のうち members に存在するものだけ返す（非メンバーへの誤通知を防ぐ）。 */
export async function membersAmong(deps: Deps, emails: string[]): Promise<string[]> {
  const uniq = [...new Set(emails.filter(Boolean))];
  if (uniq.length === 0) return [];
  const rows = await deps.db
    .select({ email: members.email })
    .from(members)
    .where(inArray(members.email, uniq));
  return rows.map((r) => r.email);
}
