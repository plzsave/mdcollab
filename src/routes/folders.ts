import { Hono } from "hono";
import type { Deps } from "../env";
import { requireMember, type Vars } from "../auth/middleware";
import { folders } from "../db/schema";

// GET  /api/folders   ≈ getFolders
// POST /api/folders   ≈ createFolder
// （renameFolder/deleteFolder/linkFolder は API インベントリ参照。linkFolder は Drive 固有=A/B 依存）
export function foldersRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  app.get("/", async (c) => {
    const rows = await deps.db.select().from(folders).orderBy(folders.createdAt);
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
