import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import type { Deps } from "../env";
import { requireMember, type Vars } from "../auth/middleware";
import { LIMITS, lengthError } from "../limits";
import { folders, documents } from "../db/schema";

// GET    /api/folders                      ≈ getFolders
// POST   /api/folders                      ≈ createFolder
// GET    /api/folders/:folderId/documents  ≈ getDocumentList（メタ DB から引く・本文は含めない）
// PATCH  /api/folders/:id                  ≈ renameFolder
// DELETE /api/folders/:id                  ≈ deleteFolder（中身がある場合は 409・誤削除防止）
// （linkFolder は Drive 固有。方針A=全移行のため保留→DriveStorage と同時期）
export function foldersRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  app.get("/", async (c) => {
    const rows = await deps.db.select().from(folders).orderBy(folders.createdAt);
    return c.json(rows);
  });

  // フォルダ内の文書メタ一覧（更新新しい順）。本文は返さない＝一覧は軽量（§6.2）。
  app.get("/:folderId/documents", async (c) => {
    const folderId = c.req.param("folderId");
    const rows = await deps.db
      .select({
        id: documents.id,
        folderId: documents.folderId,
        title: documents.title,
        version: documents.version,
        statusId: documents.statusId,
        archived: documents.archived,
        assignee: documents.assignee,
        createdBy: documents.createdBy,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(eq(documents.folderId, folderId))
      .orderBy(desc(documents.updatedAt));
    return c.json(rows);
  });

  app.post("/", async (c) => {
    const email = c.get("email");
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    if (!body.name) {
      return c.json({ error: { code: "BAD_REQUEST", message: "name required" } }, 400);
    }
    if (body.name.length > LIMITS.folderName) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: `name too long (max ${LIMITS.folderName} chars)` } },
        400,
      );
    }
    const rows = await deps.db
      .insert(folders)
      .values({ id: crypto.randomUUID(), name: body.name, createdBy: email })
      .returning();
    return c.json(rows[0], 201);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    if (!body.name) {
      return c.json({ error: { code: "BAD_REQUEST", message: "name required" } }, 400);
    }
    if (body.name.length > LIMITS.folderName) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: `name too long (max ${LIMITS.folderName} chars)` } },
        400,
      );
    }
    const rows = await deps.db
      .update(folders)
      .set({ name: body.name })
      .where(eq(folders.id, id))
      .returning();
    if (rows.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "folder not found" } }, 404);
    }
    return c.json(rows[0]);
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const [folder] = await deps.db.select().from(folders).where(eq(folders.id, id)).limit(1);
    if (!folder) return c.json({ error: { code: "NOT_FOUND", message: "folder not found" } }, 404);

    // 中に文書がある場合は消さない（誤削除・文書孤児化の防止）。先に移動/削除してもらう。
    const [doc] = await deps.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.folderId, id))
      .limit(1);
    if (doc) {
      return c.json(
        { error: { code: "CONFLICT", message: "folder is not empty" } },
        409,
      );
    }
    await deps.db.delete(folders).where(eq(folders.id, id));
    return c.json({ ok: true });
  });

  return app;
}
