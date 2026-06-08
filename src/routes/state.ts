import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Deps } from "../env";
import { requireMember, type Vars } from "../auth/middleware";
import { members, folders, statuses, notifications } from "../db/schema";

// GET /api/state  ≈ 旧 getAppState（起動時ブートストラップ束・往復削減の要）
export function stateRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  app.get("/state", async (c) => {
    const email = c.get("email");
    const [memberRows, folderRows, statusRows, notifRows] = await Promise.all([
      deps.db.select().from(members),
      deps.db.select().from(folders),
      deps.db.select().from(statuses).orderBy(statuses.sortOrder),
      deps.db.select().from(notifications).where(eq(notifications.recipient, email)),
    ]);
    return c.json({
      currentUser: { email, name: c.get("name") ?? null, role: c.get("role") ?? "member" },
      members: memberRows,
      folders: folderRows,
      statuses: statusRows,
      notifications: notifRows,
    });
  });

  return app;
}
