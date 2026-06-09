import { Hono } from "hono";
import type { Deps } from "../env";
import { requireMember, requireOwner, type Vars } from "../auth/middleware";
import { statuses } from "../db/schema";

// GET /api/statuses   ≈ getStatuses（member）
// PUT /api/statuses   ≈ saveStatuses（owner・一括置換。order 込み）
export function statusesRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  app.get("/", async (c) => {
    const rows = await deps.db.select().from(statuses).orderBy(statuses.sortOrder);
    return c.json(rows);
  });

  // 一括置換: 受け取った配列で全件入れ替える（旧 saveStatuses と同義）。
  app.put("/", requireOwner(), async (c) => {
    const body = await c.req
      .json<{ id?: string; label?: string; sortOrder?: number }[]>()
      .catch(() => null);
    if (!Array.isArray(body)) {
      return c.json({ error: { code: "BAD_REQUEST", message: "array body required" } }, 400);
    }
    for (const s of body) {
      if (!s || typeof s.label !== "string" || s.label.length === 0) {
        return c.json({ error: { code: "BAD_REQUEST", message: "each status needs a label" } }, 400);
      }
    }

    const values = body.map((s, i) => ({
      id: s.id ?? crypto.randomUUID(),
      label: s.label as string,
      sortOrder: typeof s.sortOrder === "number" ? s.sortOrder : i,
    }));

    const result = await deps.db.transaction(async (tx) => {
      await tx.delete(statuses);
      if (values.length > 0) await tx.insert(statuses).values(values);
      return tx.select().from(statuses).orderBy(statuses.sortOrder);
    });
    return c.json(result);
  });

  return app;
}
