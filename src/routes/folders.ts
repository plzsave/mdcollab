import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import type { Deps } from "../env";
import { requireMember, type Vars } from "../auth/middleware";
import { folders, documents } from "../db/schema";

// GET  /api/folders                      ≈ getFolders
// POST /api/folders                      ≈ createFolder
// GET  /api/folders/:folderId/documents  ≈ getDocumentList（メタ DB から引く・本文は含めない）
// （renameFolder/deleteFolder/linkFolder は API インベントリ参照。linkFolder は Drive 固有=A/B 依存）
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
    const rows = await deps.db
      .insert(folders)
      .values({ id: crypto.randomUUID(), name: body.name, createdBy: email })
      .returning();
    return c.json(rows[0], 201);
  });

  return app;
}
