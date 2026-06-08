import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { Deps } from "../env";
import { requireMember, type Vars } from "../auth/middleware";
import { documents, documentVersions } from "../db/schema";

// GET /api/documents/:id  ≈ getDocument（本体は DocumentStore 経由）
// PUT /api/documents/:id  ≈ updateDocument（If-Match: version → 条件付き更新 / 409 CONFLICT・§6.3）
export function documentsRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const rows = await deps.db.select().from(documents).where(eq(documents.id, id)).limit(1);
    const doc = rows[0];
    if (!doc) return c.json({ error: { code: "NOT_FOUND", message: "document not found" } }, 404);

    const ref = doc.storageKey ?? doc.driveFileId;
    const content = ref ? await deps.store.get(ref) : "";
    return c.json({ id: doc.id, title: doc.title, content, version: doc.version });
  });

  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const email = c.get("email");
    const body = await c.req.json<{ content?: string }>().catch(() => ({}) as { content?: string });
    if (typeof body.content !== "string") {
      return c.json({ error: { code: "BAD_REQUEST", message: "content required" } }, 400);
    }

    const rows = await deps.db.select().from(documents).where(eq(documents.id, id)).limit(1);
    const doc = rows[0];
    if (!doc) return c.json({ error: { code: "NOT_FOUND", message: "document not found" } }, 404);

    const ifMatch = c.req.header("If-Match");
    const expected = ifMatch ? Number(ifMatch.replace(/"/g, "")) : doc.version;
    const next = doc.version + 1;

    // 先に新 version の本体を書く（失敗時の孤児は無害・§6.3）。
    const newKey = await deps.store.put(doc.id, next, body.content);

    // 条件付き更新: WHERE version = expected。0 行なら CONFLICT。
    const updated = await deps.db
      .update(documents)
      .set({
        version: next,
        storageKey: deps.store.backend === "s3" ? newKey : doc.storageKey,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, id), eq(documents.version, expected)))
      .returning({ version: documents.version });

    if (updated.length === 0) {
      return c.json(
        { error: { code: "CONFLICT", message: "version mismatch" }, current: doc.version },
        409,
      );
    }

    // 版履歴（Drive 安全網の代替・§6.4）
    await deps.db.insert(documentVersions).values({
      documentId: doc.id,
      version: next,
      storageKey: newKey,
      createdBy: email,
    });

    return c.json({ id: doc.id, version: next });
  });

  return app;
}
