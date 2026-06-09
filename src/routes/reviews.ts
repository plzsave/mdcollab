import { Hono, type Context } from "hono";
import { and, eq, desc } from "drizzle-orm";
import { streamSSE } from "hono/streaming";
import type { Deps } from "../env";
import { requireMember, type Vars } from "../auth/middleware";
import { documents, reviews, revisions, members, aiKeys, aiSettings } from "../db/schema";
import { decryptSecret } from "../crypto";
import type { LlmInput } from "../llm/types";

// AI レビュー / 改稿。
//   POST   /api/documents/:id/review        ≈ reviewDocument（SSE 対応: ?stream=1）
//   POST   /api/documents/:id/review-repo   ≈ reviewDocumentRepo（GitHub リポジトリ文脈）
//   GET    /api/documents/:id/reviews       ≈ getReviews
//   POST   /api/documents/:id/revision      ≈ proposeRevision（doc×user で1件）
//   DELETE /api/documents/:id/revision      ≈ discardPendingRevision

interface RunConfig {
  provider: string;
  model: string;
  apiKey: string;
}

// 本人の AI 実行設定（provider/model + 復号済みキー）。未設定なら null。
async function loadRunConfig(deps: Deps, email: string): Promise<RunConfig | null> {
  const [s] = await deps.db.select().from(aiSettings).where(eq(aiSettings.email, email)).limit(1);
  if (!s?.provider || !s?.model) return null;
  const [k] = await deps.db
    .select()
    .from(aiKeys)
    .where(and(eq(aiKeys.email, email), eq(aiKeys.provider, s.provider)))
    .limit(1);
  if (!k) return null;
  const apiKey = await decryptSecret(k.encryptedKey, deps.config.encryptionKey);
  return { provider: s.provider, model: s.model, apiKey };
}

async function displayNameOf(deps: Deps, email: string): Promise<string> {
  const [m] = await deps.db
    .select({ displayName: members.displayName })
    .from(members)
    .where(eq(members.email, email))
    .limit(1);
  return m?.displayName ?? email;
}

async function loadDocContent(deps: Deps, id: string) {
  const [doc] = await deps.db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return null;
  const ref = doc.storageKey ?? doc.driveFileId;
  const content = ref ? await deps.store.get(ref) : "";
  return { doc, content };
}

function reviewPrompt(content: string, instructions: string, repo?: string): string {
  const repoLine = repo ? `\n# 参照リポジトリ\n${repo}\n` : "";
  return `次の Markdown 文書をレビューし、改善点を具体的に指摘してください。${repoLine}\n# 指示\n${instructions || "(特になし)"}\n\n# 文書\n${content}`;
}

const REVIEW_SYSTEM = "あなたは丁寧で具体的なテクニカルライティングのレビュアーです。";

type Ctx = Context<{ Variables: Vars }>;

const wantsStream = (c: Ctx) =>
  c.req.query("stream") === "1" || (c.req.header("accept") ?? "").includes("text/event-stream");

export function reviewsRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  // レビュー本体（review / review-repo 共用）。stream 指定時は SSE、それ以外は JSON。
  async function runReview(c: Ctx, opts: { repo?: string }) {
    const id = c.req.param("id")!;
    const email = c.get("email");
    const body = await c.req
      .json<{ instructions?: string }>()
      .catch(() => ({}) as { instructions?: string });

    const loaded = await loadDocContent(deps, id);
    if (!loaded) return c.json({ error: { code: "NOT_FOUND", message: "document not found" } }, 404);
    const cfg = await loadRunConfig(deps, email);
    if (!cfg) return c.json({ error: { code: "BAD_REQUEST", message: "AI not configured" } }, 400);

    const input: LlmInput = {
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      system: REVIEW_SYSTEM,
      prompt: reviewPrompt(loaded.content, body.instructions ?? "", opts.repo),
    };

    const persist = async (text: string) => {
      const [saved] = await deps.db
        .insert(reviews)
        .values({
          id: crypto.randomUUID(),
          documentId: id,
          provider: cfg.provider,
          model: cfg.model,
          content: text,
          createdBy: email,
        })
        .returning();
      return saved!;
    };

    if (wantsStream(c)) {
      return streamSSE(c, async (stream) => {
        let full = "";
        for await (const chunk of deps.llm.stream(input)) {
          full += chunk;
          await stream.writeSSE({ event: "delta", data: chunk });
        }
        const saved = await persist(full);
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({ id: saved.id, provider: cfg.provider, model: cfg.model, repo: opts.repo }),
        });
      });
    }

    const text = await deps.llm.complete(input);
    const saved = await persist(text);
    return c.json({
      id: saved.id,
      review: text,
      provider: cfg.provider,
      model: cfg.model,
      createdAt: saved.createdAt,
      createdByName: await displayNameOf(deps, email),
      ...(opts.repo ? { repo: opts.repo } : {}),
    });
  }

  app.post("/documents/:id/review", (c) => runReview(c, {}));

  app.post("/documents/:id/review-repo", async (c) => {
    const email = c.get("email");
    const body = await c.req
      .json<{ instructions?: string; repoOverride?: string }>()
      .catch(() => ({}) as { instructions?: string; repoOverride?: string });
    const [s] = await deps.db.select().from(aiSettings).where(eq(aiSettings.email, email)).limit(1);
    const repo = body.repoOverride ?? s?.githubRepo ?? undefined;
    if (!repo) {
      return c.json({ error: { code: "BAD_REQUEST", message: "github repo not configured" } }, 400);
    }
    // NOTE: 現状はリポジトリ参照をプロンプトに含めるのみ。リポジトリ本体の取得（README/コード）は
    // GitHub PAT を使った follow-up（横断B の GitHub クライアント実装）で対応する。
    return runReview(c, { repo });
  });

  app.get("/documents/:id/reviews", async (c) => {
    const id = c.req.param("id");
    const rows = await deps.db
      .select()
      .from(reviews)
      .where(eq(reviews.documentId, id))
      .orderBy(desc(reviews.createdAt));
    return c.json(rows);
  });

  // pending な AI 改稿ドラフトを生成（doc×user で1件・upsert）。
  app.post("/documents/:id/revision", async (c) => {
    const id = c.req.param("id");
    const email = c.get("email");
    const body = await c.req
      .json<{ reviewContent?: string; instructions?: string }>()
      .catch(() => ({}) as { reviewContent?: string; instructions?: string });

    const loaded = await loadDocContent(deps, id);
    if (!loaded) return c.json({ error: { code: "NOT_FOUND", message: "document not found" } }, 404);
    const cfg = await loadRunConfig(deps, email);
    if (!cfg) return c.json({ error: { code: "BAD_REQUEST", message: "AI not configured" } }, 400);

    const prompt = `次の Markdown 文書を、レビュー指摘と指示に従って書き直した全文を返してください。\n\n# レビュー\n${body.reviewContent ?? "(なし)"}\n\n# 指示\n${body.instructions ?? "(特になし)"}\n\n# 文書\n${loaded.content}`;
    const revised = await deps.llm.complete({
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      system: "あなたは文書を丁寧に推敲して書き直す編集者です。本文のみを返します。",
      prompt,
    });

    const values = {
      id: crypto.randomUUID(),
      documentId: id,
      createdBy: email,
      content: revised,
      baseVersion: loaded.doc.version,
      provider: cfg.provider,
      model: cfg.model,
    };
    await deps.db
      .insert(revisions)
      .values(values)
      .onConflictDoUpdate({
        target: [revisions.documentId, revisions.createdBy],
        set: { content: revised, baseVersion: loaded.doc.version, provider: cfg.provider, model: cfg.model },
      });

    return c.json({
      revised,
      provider: cfg.provider,
      model: cfg.model,
      baseVersion: loaded.doc.version,
    });
  });

  app.delete("/documents/:id/revision", async (c) => {
    const id = c.req.param("id");
    const email = c.get("email");
    await deps.db
      .delete(revisions)
      .where(and(eq(revisions.documentId, id), eq(revisions.createdBy, email)));
    return c.json({ ok: true });
  });

  return app;
}
