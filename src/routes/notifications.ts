import { Hono } from "hono";
import { and, eq, desc } from "drizzle-orm";
import type { Deps } from "../env";
import { requireMember, type Vars } from "../auth/middleware";
import { notifications } from "../db/schema";

// 通知（すべて本人宛のみ操作可）。
//   GET  /api/notifications              ≈ getNotifications
//   POST /api/notifications/:id/read     ≈ markNotificationRead
//   POST /api/notifications/read-all     ≈ markAllNotificationsRead
export function notificationsRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  app.get("/", async (c) => {
    const email = c.get("email");
    const rows = await deps.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipient, email))
      .orderBy(desc(notifications.createdAt));
    return c.json(rows);
  });

  app.post("/read-all", async (c) => {
    const email = c.get("email");
    await deps.db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.recipient, email));
    return c.json({ ok: true });
  });

  app.post("/:id/read", async (c) => {
    const id = c.req.param("id");
    const email = c.get("email");
    // 本人宛のものだけ既読化（他人の通知 id を指定しても 0 行→404）。
    const updated = await deps.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.recipient, email)))
      .returning({ id: notifications.id });
    if (updated.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "notification not found" } }, 404);
    }
    return c.json({ ok: true });
  });

  return app;
}
