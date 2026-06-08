import { Hono } from "hono";
import type { Deps } from "./env";
import { sessionMiddleware, type Vars } from "./auth/middleware";
import { authRoutes } from "./routes/auth";
import { stateRoutes } from "./routes/state";
import { foldersRoutes } from "./routes/folders";
import { documentsRoutes } from "./routes/documents";

// ランタイム非依存のコア。adapters/* が Deps を組み立ててこれを呼ぶ（§5.1）。
// Web標準(fetch)だけに依存し、Workers/Node/Lambda で同一に動く。
export function createApp(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("*", sessionMiddleware(deps));

  app.route("/api/auth", authRoutes(deps));
  app.route("/api", stateRoutes(deps));
  app.route("/api/folders", foldersRoutes(deps));
  app.route("/api/documents", documentsRoutes(deps));

  return app;
}

export type App = ReturnType<typeof createApp>;
