import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import type { Deps } from "../env";
import { requireMember, type Vars } from "../auth/middleware";
import { LIMITS, lengthError } from "../limits";
import { documents, threads, comments } from "../db/schema";
import { notify, membersAmong } from "../notify";
import { AI_THREAD_AUTHOR, recordAiEvent } from "../ai/events";

// スレッド / コメント（コラボ中核）。通知の副作用も発火（横断B）。
//   GET    /api/documents/:id/threads        ≈ getThreadsForDocument
//   POST   /api/documents/:id/threads        ≈ createThread（mention 通知）
//   POST   /api/threads/:threadId/comments   ≈ addReply（reply + mention 通知）
//   POST   /api/threads/:threadId/resolve    ≈ resolveThread（resolve 通知）
//   POST   /api/threads/:threadId/reopen     ≈ reopenThread
//   PATCH  /api/comments/:commentId          ≈ editComment（著者のみ）
//   DELETE /api/comments/:commentId          ≈ deleteComment（著者のみ・論理削除）
export function commentsRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  // 文書のスレッド一覧（各スレッドに非削除コメントを同梱）。
  app.get("/documents/:id/threads", async (c) => {
    const id = c.req.param("id");
    const threadRows = await deps.db
      .select()
      .from(threads)
      .where(eq(threads.documentId, id))
      .orderBy(threads.createdAt);
    const tids = threadRows.map((t) => t.id);
    const commentRows = tids.length
      ? await deps.db
          .select()
          .from(comments)
          .where(and(inArray(comments.threadId, tids), eq(comments.deleted, false)))
          .orderBy(comments.createdAt)
      : [];
    return c.json(
      threadRows.map((t) => ({ ...t, comments: commentRows.filter((cm) => cm.threadId === t.id) })),
    );
  });

  // スレッド作成（アンカー＋初コメントを同時生成）。mention に通知。
  app.post("/documents/:id/threads", async (c) => {
    const documentId = c.req.param("id");
    const email = c.get("email");
    const body = await c.req
      .json<{
        anchorText?: string;
        anchorBefore?: string;
        anchorAfter?: string;
        firstComment?: string;
        mentions?: string[];
      }>()
      .catch(() => ({}) as Record<string, never>);
    if (!body.anchorText || !body.firstComment) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "anchorText and firstComment required" } },
        400,
      );
    }
    const lenErr = lengthError([
      [body.anchorText, LIMITS.anchorText, "anchorText"],
      [body.anchorBefore, LIMITS.anchorContext, "anchorBefore"],
      [body.anchorAfter, LIMITS.anchorContext, "anchorAfter"],
      [body.firstComment, LIMITS.commentBody, "firstComment"],
    ]);
    if (lenErr) return c.json({ error: { code: "BAD_REQUEST", message: lenErr } }, 400);
    const doc = (
      await deps.db.select().from(documents).where(eq(documents.id, documentId)).limit(1)
    )[0];
    if (!doc) return c.json({ error: { code: "NOT_FOUND", message: "document not found" } }, 404);

    const threadId = crypto.randomUUID();
    const commentId = crypto.randomUUID();
    const mentions = Array.isArray(body.mentions) ? body.mentions : [];

    await deps.db.insert(threads).values({
      id: threadId,
      documentId,
      anchorText: body.anchorText,
      anchorBefore: body.anchorBefore ?? null,
      anchorAfter: body.anchorAfter ?? null,
      createdBy: email,
    });
    await deps.db.insert(comments).values({
      id: commentId,
      threadId,
      content: body.firstComment,
      author: email,
      mentions: mentions.length ? mentions.join(",") : null,
    });

    const mentionTargets = await membersAmong(deps, mentions);
    await notify(deps, {
      type: "mention",
      recipients: mentionTargets,
      actor: email,
      threadId,
      commentId,
      documentId,
      documentName: doc.title,
    });

    const created = (await deps.db.select().from(threads).where(eq(threads.id, threadId)).limit(1))[0];
    const firstComments = await deps.db.select().from(comments).where(eq(comments.threadId, threadId));
    return c.json({ ...created, comments: firstComments }, 201);
  });

  // 返信。mention に mention 通知、スレッド参加者に reply 通知。
  app.post("/threads/:threadId/comments", async (c) => {
    const threadId = c.req.param("threadId");
    const email = c.get("email");
    const body = await c.req
      .json<{ content?: string; mentions?: string[] }>()
      .catch(() => ({}) as { content?: string; mentions?: string[] });
    if (!body.content) {
      return c.json({ error: { code: "BAD_REQUEST", message: "content required" } }, 400);
    }
    if (body.content.length > LIMITS.commentBody) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: `content too long (max ${LIMITS.commentBody} chars)` } },
        400,
      );
    }
    const thread = (await deps.db.select().from(threads).where(eq(threads.id, threadId)).limit(1))[0];
    if (!thread) return c.json({ error: { code: "NOT_FOUND", message: "thread not found" } }, 404);
    const doc = (
      await deps.db.select().from(documents).where(eq(documents.id, thread.documentId)).limit(1)
    )[0];

    const commentId = crypto.randomUUID();
    const mentions = Array.isArray(body.mentions) ? body.mentions : [];
    await deps.db.insert(comments).values({
      id: commentId,
      threadId,
      content: body.content,
      author: email,
      mentions: mentions.length ? mentions.join(",") : null,
    });

    // mention 通知（メンバーのみ）
    const mentionTargets = await membersAmong(deps, mentions);
    await notify(deps, {
      type: "mention",
      recipients: mentionTargets,
      actor: email,
      threadId,
      commentId,
      documentId: thread.documentId,
      documentName: doc?.title,
    });

    // reply 通知: スレッド参加者（作成者＋既コメント著者）から actor と mention 済みを除く
    const authors = await deps.db
      .select({ author: comments.author })
      .from(comments)
      .where(eq(comments.threadId, threadId));
    const participants = new Set(authors.map((a) => a.author));
    participants.add(thread.createdBy);
    for (const m of mentionTargets) participants.delete(m);
    await notify(deps, {
      type: "reply",
      recipients: [...participants],
      actor: email,
      threadId,
      commentId,
      documentId: thread.documentId,
      documentName: doc?.title,
    });

    const created = (await deps.db.select().from(comments).where(eq(comments.id, commentId)).limit(1))[0];
    return c.json(created, 201);
  });

  app.post("/threads/:threadId/resolve", async (c) => {
    const threadId = c.req.param("threadId");
    const email = c.get("email");
    const thread = (await deps.db.select().from(threads).where(eq(threads.id, threadId)).limit(1))[0];
    if (!thread) return c.json({ error: { code: "NOT_FOUND", message: "thread not found" } }, 404);

    await deps.db
      .update(threads)
      .set({ status: "resolved", resolvedBy: email, resolvedAt: new Date() })
      .where(eq(threads.id, threadId));

    // AI レビューの指摘が解決された＝採用の信号（Tier 1）。
    if (thread.createdBy === AI_THREAD_AUTHOR) {
      await recordAiEvent(deps, { documentId: thread.documentId, actor: email, action: "thread_resolved", count: 1 });
    }

    const doc = (
      await deps.db.select().from(documents).where(eq(documents.id, thread.documentId)).limit(1)
    )[0];
    const authors = await deps.db
      .select({ author: comments.author })
      .from(comments)
      .where(eq(comments.threadId, threadId));
    const participants = new Set(authors.map((a) => a.author));
    participants.add(thread.createdBy);
    await notify(deps, {
      type: "resolve",
      recipients: [...participants],
      actor: email,
      threadId,
      documentId: thread.documentId,
      documentName: doc?.title,
    });
    return c.json({ ok: true });
  });

  app.post("/threads/:threadId/reopen", async (c) => {
    const threadId = c.req.param("threadId");
    const thread = (await deps.db.select().from(threads).where(eq(threads.id, threadId)).limit(1))[0];
    if (!thread) return c.json({ error: { code: "NOT_FOUND", message: "thread not found" } }, 404);
    await deps.db
      .update(threads)
      .set({ status: "open", resolvedBy: null, resolvedAt: null })
      .where(eq(threads.id, threadId));
    return c.json({ ok: true });
  });

  app.patch("/comments/:commentId", async (c) => {
    const commentId = c.req.param("commentId");
    const email = c.get("email");
    const body = await c.req
      .json<{ content?: string }>()
      .catch(() => ({}) as { content?: string });
    if (!body.content) {
      return c.json({ error: { code: "BAD_REQUEST", message: "content required" } }, 400);
    }
    if (body.content.length > LIMITS.commentBody) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: `content too long (max ${LIMITS.commentBody} chars)` } },
        400,
      );
    }
    const cm = (await deps.db.select().from(comments).where(eq(comments.id, commentId)).limit(1))[0];
    if (!cm || cm.deleted) {
      return c.json({ error: { code: "NOT_FOUND", message: "comment not found" } }, 404);
    }
    if (cm.author !== email) {
      return c.json({ error: { code: "FORBIDDEN", message: "author only" } }, 403);
    }
    const updated = await deps.db
      .update(comments)
      .set({ content: body.content, updatedAt: new Date() })
      .where(eq(comments.id, commentId))
      .returning();
    return c.json(updated[0]);
  });

  app.delete("/comments/:commentId", async (c) => {
    const commentId = c.req.param("commentId");
    const email = c.get("email");
    const cm = (await deps.db.select().from(comments).where(eq(comments.id, commentId)).limit(1))[0];
    if (!cm || cm.deleted) {
      return c.json({ error: { code: "NOT_FOUND", message: "comment not found" } }, 404);
    }
    if (cm.author !== email) {
      return c.json({ error: { code: "FORBIDDEN", message: "author only" } }, 403);
    }
    // 論理削除（旧仕様踏襲）。
    await deps.db.update(comments).set({ deleted: true }).where(eq(comments.id, commentId));
    return c.json({ ok: true });
  });

  return app;
}
