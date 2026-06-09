import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Deps } from "../env";
import { requireMember, requireOwner, type Vars } from "../auth/middleware";
import { members } from "../db/schema";

// GET    /api/members         ≈ getMembers（member）
// POST   /api/members         ≈ addMember（owner）
// PATCH  /api/members/:email  ≈ updateMember（owner）
// DELETE /api/members/:email  ≈ removeMember（owner）
export function membersRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  app.get("/", async (c) => {
    const rows = await deps.db.select().from(members).orderBy(members.email);
    return c.json(rows);
  });

  app.post("/", requireOwner(), async (c) => {
    const actor = c.get("email");
    const body = await c.req
      .json<{ email?: string; displayName?: string; role?: string }>()
      .catch(() => ({}) as { email?: string; displayName?: string; role?: string });
    if (!body.email || !body.displayName) {
      return c.json({ error: { code: "BAD_REQUEST", message: "email and displayName required" } }, 400);
    }
    const role = body.role === "owner" ? "owner" : "member";

    const existing = await deps.db
      .select()
      .from(members)
      .where(eq(members.email, body.email))
      .limit(1);
    if (existing[0]) {
      return c.json({ error: { code: "CONFLICT", message: "member already exists" } }, 409);
    }

    const rows = await deps.db
      .insert(members)
      .values({ email: body.email, displayName: body.displayName, role, addedBy: actor })
      .returning();
    return c.json(rows[0], 201);
  });

  app.patch("/:email", requireOwner(), async (c) => {
    const email = c.req.param("email");
    const body = await c.req
      .json<{ displayName?: string; role?: string }>()
      .catch(() => ({}) as { displayName?: string; role?: string });

    const rows = await deps.db.select().from(members).where(eq(members.email, email)).limit(1);
    const target = rows[0];
    if (!target) return c.json({ error: { code: "NOT_FOUND", message: "member not found" } }, 404);

    const patch: { displayName?: string; role?: string } = {};
    if (typeof body.displayName === "string" && body.displayName.length > 0) {
      patch.displayName = body.displayName;
    }
    if (body.role === "owner" || body.role === "member") patch.role = body.role;
    if (Object.keys(patch).length === 0) {
      return c.json({ error: { code: "BAD_REQUEST", message: "nothing to update" } }, 400);
    }

    // owner を member に降格して owner がゼロになるのを防ぐ（締め出し防止）。
    if (target.role === "owner" && patch.role === "member") {
      const owners = await deps.db.select().from(members).where(eq(members.role, "owner"));
      if (owners.length <= 1) {
        return c.json({ error: { code: "BAD_REQUEST", message: "cannot demote the last owner" } }, 400);
      }
    }

    const updated = await deps.db
      .update(members)
      .set(patch)
      .where(eq(members.email, email))
      .returning();
    return c.json(updated[0]);
  });

  app.delete("/:email", requireOwner(), async (c) => {
    const email = c.req.param("email");
    const rows = await deps.db.select().from(members).where(eq(members.email, email)).limit(1);
    const target = rows[0];
    if (!target) return c.json({ error: { code: "NOT_FOUND", message: "member not found" } }, 404);

    // 最後の owner を消すと誰も管理できなくなるため拒否（締め出し防止）。
    if (target.role === "owner") {
      const owners = await deps.db.select().from(members).where(eq(members.role, "owner"));
      if (owners.length <= 1) {
        return c.json({ error: { code: "BAD_REQUEST", message: "cannot remove the last owner" } }, 400);
      }
    }

    await deps.db.delete(members).where(eq(members.email, email));
    return c.json({ ok: true });
  });

  return app;
}
