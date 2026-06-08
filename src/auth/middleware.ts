import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { Deps } from "../env";
import { verifySession } from "./session";
import { members } from "../db/schema";

export const SESSION_COOKIE = "mdcollab_session";

// Hono コンテキスト変数。requireMember 通過後は email/role が確定する。
export type Vars = {
  email: string;
  name?: string;
  role?: string;
};

type Env = { Variables: Vars };

/** セッション Cookie を検証し email/name をセット（未ログインでも通す） */
export function sessionMiddleware(deps: Deps): MiddlewareHandler<Env> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const sess = await verifySession(token, deps.config.sessionSecret);
      if (sess) {
        c.set("email", sess.email);
        if (sess.name) c.set("name", sess.name);
      }
    }
    await next();
  };
}

/** ログイン済み かつ members に存在することを要求（旧 requireMember 相当・§7.3） */
export function requireMember(deps: Deps): MiddlewareHandler<Env> {
  return async (c, next) => {
    const email = c.get("email");
    if (!email) {
      return c.json({ error: { code: "UNAUTHENTICATED", message: "login required" } }, 401);
    }
    const rows = await deps.db.select().from(members).where(eq(members.email, email)).limit(1);
    const m = rows[0];
    if (!m) {
      return c.json({ error: { code: "FORBIDDEN", message: "not a member" } }, 403);
    }
    c.set("role", m.role);
    await next();
  };
}

/** owner ロールを要求（旧 isOwner 相当）。requireMember の後段で使う */
export function requireOwner(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (c.get("role") !== "owner") {
      return c.json({ error: { code: "FORBIDDEN", message: "owner only" } }, 403);
    }
    await next();
  };
}
