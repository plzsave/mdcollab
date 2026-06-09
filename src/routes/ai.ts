import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { Deps } from "../env";
import { requireMember, type Vars } from "../auth/middleware";
import { aiKeys, aiSettings } from "../db/schema";
import { encryptSecret, decryptSecret } from "../crypto";

// AI 設定 / 秘密（すべて本人のみ）。**キー平文はクライアントへ返さない**不変条件（§6.5）。
//   GET    /api/ai/settings          ≈ getAiSettings（has-key 真偽のみ）
//   PUT    /api/ai/settings          ≈ saveAiSettings（provider/model + apiKey 暗号化保存）
//   DELETE /api/ai/keys/:provider    ≈ clearAiKey
//   PUT    /api/ai/github/pat        ≈ saveGithubPat（scope, pat 暗号化）
//   DELETE /api/ai/github/pat?scope= ≈ clearGithubPat
//   PUT    /api/ai/github/repo       ≈ saveGithubRepo
//   GET    /api/ai/models?provider=  ≈ listAiModels（プロバイダ /models 中継）

const GITHUB_PREFIX = "github:";

// 本人の設定ビューを組み立てる（秘密は真偽/スコープのみ・平文は絶対に含めない）。
async function loadSettings(deps: Deps, email: string) {
  const [settingsRow] = await deps.db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.email, email))
    .limit(1);
  const keyRows = await deps.db.select().from(aiKeys).where(eq(aiKeys.email, email));

  const keys: Record<string, boolean> = {};
  const githubPats: string[] = [];
  for (const k of keyRows) {
    if (k.provider.startsWith(GITHUB_PREFIX)) {
      githubPats.push(k.provider.slice(GITHUB_PREFIX.length));
    } else {
      keys[k.provider] = true;
    }
  }
  return {
    provider: settingsRow?.provider ?? null,
    model: settingsRow?.model ?? null,
    githubRepo: settingsRow?.githubRepo ?? null,
    keys,
    githubPats,
  };
}

// ai_settings を部分更新（read-merge-write で null 上書きを避ける）。
async function upsertSettings(
  deps: Deps,
  email: string,
  patch: { provider?: string | null; model?: string | null; githubRepo?: string | null },
) {
  const [cur] = await deps.db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.email, email))
    .limit(1);
  const next = {
    email,
    provider: patch.provider !== undefined ? patch.provider : (cur?.provider ?? null),
    model: patch.model !== undefined ? patch.model : (cur?.model ?? null),
    githubRepo: patch.githubRepo !== undefined ? patch.githubRepo : (cur?.githubRepo ?? null),
  };
  await deps.db
    .insert(aiSettings)
    .values(next)
    .onConflictDoUpdate({ target: aiSettings.email, set: next });
}

async function upsertKey(deps: Deps, email: string, provider: string, plaintext: string) {
  const encryptedKey = await encryptSecret(plaintext, deps.config.encryptionKey);
  await deps.db
    .insert(aiKeys)
    .values({ email, provider, encryptedKey })
    .onConflictDoUpdate({ target: [aiKeys.email, aiKeys.provider], set: { encryptedKey } });
}

export function aiRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  app.get("/settings", async (c) => {
    return c.json(await loadSettings(deps, c.get("email")));
  });

  app.put("/settings", async (c) => {
    const email = c.get("email");
    const body = await c.req
      .json<{ provider?: string; apiKey?: string; model?: string }>()
      .catch(() => ({}) as { provider?: string; apiKey?: string; model?: string });
    if (!body.provider) {
      return c.json({ error: { code: "BAD_REQUEST", message: "provider required" } }, 400);
    }
    await upsertSettings(deps, email, { provider: body.provider, model: body.model ?? undefined });
    if (typeof body.apiKey === "string" && body.apiKey.length > 0) {
      await upsertKey(deps, email, body.provider, body.apiKey);
    }
    return c.json(await loadSettings(deps, email));
  });

  app.delete("/keys/:provider", async (c) => {
    const email = c.get("email");
    const provider = c.req.param("provider");
    await deps.db
      .delete(aiKeys)
      .where(and(eq(aiKeys.email, email), eq(aiKeys.provider, provider)));
    return c.json(await loadSettings(deps, email));
  });

  app.put("/github/pat", async (c) => {
    const email = c.get("email");
    const body = await c.req
      .json<{ scope?: string; pat?: string }>()
      .catch(() => ({}) as { scope?: string; pat?: string });
    if (!body.scope || !body.pat) {
      return c.json({ error: { code: "BAD_REQUEST", message: "scope and pat required" } }, 400);
    }
    await upsertKey(deps, email, `${GITHUB_PREFIX}${body.scope}`, body.pat);
    return c.json(await loadSettings(deps, email));
  });

  app.delete("/github/pat", async (c) => {
    const email = c.get("email");
    const scope = c.req.query("scope");
    if (!scope) {
      return c.json({ error: { code: "BAD_REQUEST", message: "scope required" } }, 400);
    }
    await deps.db
      .delete(aiKeys)
      .where(and(eq(aiKeys.email, email), eq(aiKeys.provider, `${GITHUB_PREFIX}${scope}`)));
    return c.json(await loadSettings(deps, email));
  });

  app.put("/github/repo", async (c) => {
    const email = c.get("email");
    const body = await c.req.json<{ repo?: string }>().catch(() => ({}) as { repo?: string });
    if (typeof body.repo !== "string") {
      return c.json({ error: { code: "BAD_REQUEST", message: "repo required" } }, 400);
    }
    await upsertSettings(deps, email, { githubRepo: body.repo });
    return c.json(await loadSettings(deps, email));
  });

  app.get("/models", async (c) => {
    const email = c.get("email");
    const provider = c.req.query("provider");
    if (!provider) {
      return c.json({ error: { code: "BAD_REQUEST", message: "provider required" } }, 400);
    }
    const [row] = await deps.db
      .select()
      .from(aiKeys)
      .where(and(eq(aiKeys.email, email), eq(aiKeys.provider, provider)))
      .limit(1);
    if (!row) {
      return c.json({ error: { code: "BAD_REQUEST", message: "no key for provider" } }, 400);
    }
    const apiKey = await decryptSecret(row.encryptedKey, deps.config.encryptionKey);
    try {
      const models = await deps.llm.listModels(provider, apiKey);
      return c.json({ models });
    } catch (e) {
      return c.json(
        { error: { code: "UPSTREAM", message: e instanceof Error ? e.message : "failed" } },
        502,
      );
    }
  });

  return app;
}
