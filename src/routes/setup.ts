import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Deps } from "../env";
import { type Vars } from "../auth/middleware";
import { members, statuses } from "../db/schema";

// POST /api/setup ≈ setupDb。方針A(全移行)では「ストレージ/DB の初期化」に読み替え。
// 鶏卵問題: 初回はまだ members が空なので requireMember を通せない。よってここは
// requireMember を使わず、セッション(email)だけ要求する独自ルーター。
//   - 初回(members 空): 呼び出した本人を owner として登録（ブートストラップ）＋既定ステータス投入
//   - 2回目以降: owner のみ可。冪等に既定ステータスを補完するだけ
// DB スキーマ自体の適用は drizzle マイグレーション（make migrate）の責務でここではやらない。
export function setupRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();

  app.post("/setup", async (c) => {
    const email = c.get("email");
    if (!email) {
      return c.json({ error: { code: "UNAUTHENTICATED", message: "login required" } }, 401);
    }
    const body = await c.req
      .json<{ displayName?: string }>()
      .catch(() => ({}) as { displayName?: string });

    const existing = await deps.db.select({ email: members.email }).from(members).limit(1);
    const firstRun = existing.length === 0;

    if (!firstRun) {
      const [me] = await deps.db
        .select({ role: members.role })
        .from(members)
        .where(eq(members.email, email))
        .limit(1);
      if (me?.role !== "owner") {
        return c.json({ error: { code: "FORBIDDEN", message: "owner only" } }, 403);
      }
    }

    await deps.db.transaction(async (tx) => {
      if (firstRun) {
        await tx
          .insert(members)
          .values({ email, displayName: body.displayName ?? c.get("name") ?? email, role: "owner" })
          .onConflictDoNothing();
      }
      await tx
        .insert(statuses)
        .values([
          { id: "draft", label: "Draft", sortOrder: 0 },
          { id: "review", label: "Review", sortOrder: 1 },
          { id: "done", label: "Done", sortOrder: 2 },
        ])
        .onConflictDoNothing();
    });

    return c.json({ ok: true, bootstrapped: firstRun });
  });

  return app;
}
