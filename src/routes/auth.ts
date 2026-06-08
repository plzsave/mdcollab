import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Deps } from "../env";
import { buildAuthUrl, exchangeCode, verifyIdToken } from "../auth/oidc";
import { createSession } from "../auth/session";
import { SESSION_COOKIE, type Vars } from "../auth/middleware";

// GET  /api/auth/login    → Google へリダイレクト
// GET  /api/auth/callback → code 交換 → IDトークン検証 → ドメイン検査 → セッション発行
// POST /api/auth/logout   → セッション破棄
export function authRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  const redirectUri = `${deps.config.baseUrl}/api/auth/callback`;
  const secure = deps.config.baseUrl.startsWith("https");

  app.get("/login", (c) => {
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const opts = { httpOnly: true, secure, sameSite: "Lax" as const, path: "/", maxAge: 600 };
    setCookie(c, "oidc_state", state, opts);
    setCookie(c, "oidc_nonce", nonce, opts);
    return c.redirect(
      buildAuthUrl({ clientId: deps.config.google.clientId, redirectUri, state, nonce }),
    );
  });

  app.get("/callback", async (c) => {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || state !== getCookie(c, "oidc_state")) {
      return c.json({ error: { code: "BAD_REQUEST", message: "invalid oauth state" } }, 400);
    }
    const idToken = await exchangeCode({
      code,
      clientId: deps.config.google.clientId,
      clientSecret: deps.config.google.clientSecret,
      redirectUri,
    });
    const claims = await verifyIdToken(idToken, deps.config.google.clientId);

    // §7.2 入口の粗いフィルタ（正の認可は members）
    if (deps.config.allowedDomain && claims.hd !== deps.config.allowedDomain) {
      return c.json({ error: { code: "FORBIDDEN", message: "domain not allowed" } }, 403);
    }

    const token = await createSession({ email: claims.email, name: claims.name }, deps.config.sessionSecret);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    deleteCookie(c, "oidc_state");
    deleteCookie(c, "oidc_nonce");
    return c.redirect("/");
  });

  app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // ⚠ ローカル検証専用。DEV_AUTH=1 のときだけ生える。Google OAuth 抜きでセッションを発行。
  // GET /api/auth/dev-login?email=you@example.com[&name=You]
  if (deps.config.devAuth) {
    app.get("/dev-login", async (c) => {
      const email = c.req.query("email");
      if (!email) {
        return c.json({ error: { code: "BAD_REQUEST", message: "email query required" } }, 400);
      }
      const token = await createSession(
        { email, name: c.req.query("name") },
        deps.config.sessionSecret,
      );
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
      return c.json({ ok: true, email, devAuth: true });
    });
  }

  return app;
}
