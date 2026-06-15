import { describe, it, expect } from "vitest";
import { makeHarness, seedMember } from "./helpers/harness";
import * as schema from "../src/db/schema";

// 運用可視化 Tier 0: /api/ai/metrics（owner 限定・content-free 集計）。

describe("AI メトリクス (/api/ai/metrics)", () => {
  it("owner: reviews の usage と ai-review スレッドの反応を集計する", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner");
    await h.db
      .insert(schema.documents)
      .values({ id: "d1", title: "D", version: 1, createdBy: "o@example.com" });
    await h.db.insert(schema.reviews).values([
      { id: "r1", documentId: "d1", provider: "anthropic", model: "claude-x", content: "a", createdBy: "o@example.com", inputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0, truncated: false },
      { id: "r2", documentId: "d1", provider: "anthropic", model: "claude-x", content: "b", createdBy: "o@example.com", inputTokens: 200, outputTokens: 40, cacheReadTokens: 100, cacheWriteTokens: 0, truncated: true },
    ]);
    await h.db.insert(schema.threads).values([
      { id: "t1", documentId: "d1", anchorText: "x", status: "resolved", createdBy: "ai-review" },
      { id: "t2", documentId: "d1", anchorText: "y", status: "open", createdBy: "ai-review" },
      { id: "t3", documentId: "d1", anchorText: "z", status: "open", createdBy: "o@example.com" }, // 人間スレは除外
    ]);

    const res = await h.req("/api/ai/metrics", { as: "o@example.com" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reviews: { total: number; byModel: { provider: string; model: string; count: number; truncated: number; inputAvg: number; outputAvg: number; cacheReadAvg: number; cacheHitPct: number }[] };
      aiThreads: { total: number; open: number; resolved: number; acceptancePct: number };
    };

    expect(body.reviews.total).toBe(2);
    const m = body.reviews.byModel[0]!;
    expect(m).toMatchObject({ provider: "anthropic", model: "claude-x", count: 2, truncated: 1 });
    expect(m.inputAvg).toBe(150); // (100+200)/2
    expect(m.outputAvg).toBe(30); // (20+40)/2
    expect(m.cacheReadAvg).toBe(200); // (300+100)/2
    expect(m.cacheHitPct).toBe(57); // cr400 / (in300+cr400) = 57%
    expect(body.aiThreads).toMatchObject({ total: 2, open: 1, resolved: 1, acceptancePct: 50 });
  });

  it("member は 403（owner 限定）", async () => {
    const h = await makeHarness();
    await seedMember(h, "m@example.com", "member");
    const res = await h.req("/api/ai/metrics", { as: "m@example.com" });
    expect(res.status).toBe(403);
  });
});
