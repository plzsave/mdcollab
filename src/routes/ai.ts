import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { Deps } from "../env";
import { requireMember, requireOwner, type Vars } from "../auth/middleware";
import { aiKeys, aiReviewEvents, aiSettings, reviews, revisions, threads } from "../db/schema";
import { encryptSecret, decryptSecret } from "../crypto";
import { loadAiSettings, GITHUB_PREFIX } from "../ai/settings";

// AI 実行のコスト/利用を content-free（本文を含めず集計値のみ）に要約する（運用の可視化・Tier 0）。
// reviews/revisions の usage 列（Phase E/H）と、ai-review スレッドの反応を既存テーブルから読むだけ。
interface UsageRow {
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  truncated?: boolean | null;
}

function summarizeRuns(rows: UsageRow[]) {
  const groups = new Map<
    string,
    { provider: string; model: string; count: number; in: number; out: number; cr: number; cw: number; truncated: number; withUsage: number }
  >();
  for (const r of rows) {
    const provider = r.provider ?? "?";
    const model = r.model ?? "?";
    const key = `${provider}/${model}`;
    const g =
      groups.get(key) ??
      { provider, model, count: 0, in: 0, out: 0, cr: 0, cw: 0, truncated: 0, withUsage: 0 };
    g.count++;
    if (r.truncated) g.truncated++;
    const hasUsage = r.inputTokens != null || r.outputTokens != null;
    if (hasUsage) {
      g.withUsage++;
      g.in += r.inputTokens ?? 0;
      g.out += r.outputTokens ?? 0;
      g.cr += r.cacheReadTokens ?? 0;
      g.cw += r.cacheWriteTokens ?? 0;
    }
    groups.set(key, g);
  }
  const byModel = [...groups.values()].map((g) => {
    const totalIn = g.in + g.cr + g.cw;
    const n = g.withUsage || 1;
    return {
      provider: g.provider,
      model: g.model,
      count: g.count,
      truncated: g.truncated,
      inputAvg: Math.round(g.in / n),
      outputAvg: Math.round(g.out / n),
      cacheReadAvg: Math.round(g.cr / n),
      cacheHitPct: totalIn ? Math.round((g.cr / totalIn) * 100) : 0,
    };
  });
  return { total: rows.length, byModel };
}

// AI 設定 / 秘密（すべて本人のみ）。**キー平文はクライアントへ返さない**不変条件（§6.5）。
//   GET    /api/ai/settings          ≈ getAiSettings（has-key 真偽のみ）
//   PUT    /api/ai/settings          ≈ saveAiSettings（provider/model + apiKey 暗号化保存）
//   DELETE /api/ai/keys/:provider    ≈ clearAiKey
//   PUT    /api/ai/github/pat        ≈ saveGithubPat（scope, pat 暗号化）
//   DELETE /api/ai/github/pat?scope= ≈ clearGithubPat
//   PUT    /api/ai/github/repo       ≈ saveGithubRepo
//   GET    /api/ai/models?provider=  ≈ listAiModels（プロバイダ /models 中継）

// 設定ビュー組み立ては src/ai/settings.ts の loadAiSettings に集約（state ルートと共有）。

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
    return c.json(await loadAiSettings(deps, c.get("email")));
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
    return c.json(await loadAiSettings(deps, email));
  });

  app.delete("/keys/:provider", async (c) => {
    const email = c.get("email");
    const provider = c.req.param("provider");
    await deps.db
      .delete(aiKeys)
      .where(and(eq(aiKeys.email, email), eq(aiKeys.provider, provider)));
    return c.json(await loadAiSettings(deps, email));
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
    return c.json(await loadAiSettings(deps, email));
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
    return c.json(await loadAiSettings(deps, email));
  });

  app.put("/github/repo", async (c) => {
    const email = c.get("email");
    const body = await c.req.json<{ repo?: string }>().catch(() => ({}) as { repo?: string });
    if (typeof body.repo !== "string") {
      return c.json({ error: { code: "BAD_REQUEST", message: "repo required" } }, 400);
    }
    await upsertSettings(deps, email, { githubRepo: body.repo });
    return c.json(await loadAiSettings(deps, email));
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

  // 運用可視化（Tier 0・owner 限定）。本文は一切含まない集計値のみ。
  // 既存の reviews/revisions usage 列と ai-review スレッドの反応から、コスト/キャッシュ効き/採用の現状を出す。
  app.get("/metrics", requireOwner(), async (c) => {
    const reviewRows = await deps.db
      .select({
        provider: reviews.provider,
        model: reviews.model,
        inputTokens: reviews.inputTokens,
        outputTokens: reviews.outputTokens,
        cacheReadTokens: reviews.cacheReadTokens,
        cacheWriteTokens: reviews.cacheWriteTokens,
        truncated: reviews.truncated,
      })
      .from(reviews);
    const revisionRows = await deps.db
      .select({
        provider: revisions.provider,
        model: revisions.model,
        inputTokens: revisions.inputTokens,
        outputTokens: revisions.outputTokens,
        cacheReadTokens: revisions.cacheReadTokens,
        cacheWriteTokens: revisions.cacheWriteTokens,
        truncated: revisions.truncated,
      })
      .from(revisions);
    const aiThreadRows = await deps.db
      .select({ status: threads.status })
      .from(threads)
      .where(eq(threads.createdBy, "ai-review"));

    const open = aiThreadRows.filter((t) => t.status === "open").length;
    const resolved = aiThreadRows.filter((t) => t.status === "resolved").length;
    const total = aiThreadRows.length;

    // Tier 1: 追記ログから採用/無視の母数を正確に出す（物理削除で消えた分も superseded として残る）。
    const eventRows = await deps.db
      .select({ action: aiReviewEvents.action, count: aiReviewEvents.count })
      .from(aiReviewEvents);
    const sumOf = (action: string) =>
      eventRows.filter((e) => e.action === action).reduce((s, e) => s + (e.count ?? 0), 0);
    const created = sumOf("threads_created");
    const resolvedEv = sumOf("thread_resolved");
    const superseded = sumOf("threads_superseded");

    return c.json({
      reviews: summarizeRuns(reviewRows),
      revisions: summarizeRuns(revisionRows),
      // スナップショット（現存する ai-review スレッド）。
      aiThreads: { total, open, resolved, acceptancePct: total ? Math.round((resolved / total) * 100) : 0 },
      // ライフタイム（追記ログ・無視された指摘も母数に残る）。採用率/ノイズ率の正確版。
      lifetime: {
        created,
        resolved: resolvedEv,
        superseded,
        acceptancePct: created ? Math.round((resolvedEv / created) * 100) : 0,
        ignoredPct: created ? Math.round((superseded / created) * 100) : 0,
      },
    });
  });

  return app;
}
