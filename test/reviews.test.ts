import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeHarness, seedMember, type Harness } from "./helpers/harness";
import * as schema from "../src/db/schema";

// メンバー + AI 設定 + 本文付き文書を用意する。
async function setup(): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  const key = await h.store.put("d1", 1, "# 文書\n本文です");
  await h.db
    .insert(schema.documents)
    .values({ id: "d1", title: "Doc", storageKey: key, version: 1, createdBy: "u@example.com" });
  await h.req("/api/ai/settings", {
    as: "u@example.com",
    method: "PUT",
    body: JSON.stringify({ provider: "anthropic", model: "claude-x", apiKey: "sk-test-123" }),
  });
  return h;
}

describe("AI Review / Revision", () => {
  it("review(非ストリーム): 結果を保存し fake LLM が文書本文を受け取る", async () => {
    const h = await setup();
    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ instructions: "簡潔に" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { review: string; provider: string };
    expect(body.provider).toBe("anthropic");
    expect(body.review).toContain("REVIEW(anthropic/claude-x)");

    // fake LLM に渡ったプロンプトに本文が含まれている
    expect(h.llm.calls[0]!.prompt).toContain("本文です");
    // 保存され一覧に出る
    const list = (await (
      await h.req("/api/documents/d1/reviews", { as: "u@example.com" })
    ).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("review(SSE): ?stream=1 でチャンクを流し最後に done", async () => {
    const h = await setup();
    const res = await h.req("/api/documents/d1/review?stream=1", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ instructions: "" }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: delta");
    expect(text).toContain("chunk-2");
    expect(text).toContain("event: done");
    // ストリームでも保存される
    const list = (await (
      await h.req("/api/documents/d1/reviews", { as: "u@example.com" })
    ).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("AI 未設定なら 400 / 文書なしは 404", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    await h.db
      .insert(schema.documents)
      .values({ id: "d1", title: "D", version: 1, createdBy: "u@example.com" });
    // 設定前 → 400
    expect(
      (
        await h.req("/api/documents/d1/review", {
          as: "u@example.com",
          method: "POST",
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(400);
    // 文書なし
    await h.req("/api/ai/settings", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ provider: "anthropic", model: "claude-x", apiKey: "k" }),
    });
    expect(
      (
        await h.req("/api/documents/none/review", {
          as: "u@example.com",
          method: "POST",
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(404);
  });

  it("review-repo: repo 未設定は 400 / 設定後は repo を返す", async () => {
    const h = await setup();
    expect(
      (
        await h.req("/api/documents/d1/review-repo", {
          as: "u@example.com",
          method: "POST",
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(400);

    await h.req("/api/ai/github/repo", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ repo: "owner/repo" }),
    });
    const res = await h.req("/api/documents/d1/review-repo", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ instructions: "見て" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ repo: "owner/repo" });
  });

  it("revision: doc×user で1件に upsert・delete で消える", async () => {
    const h = await setup();
    await h.req("/api/documents/d1/revision", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ reviewContent: "誤字あり", instructions: "直して" }),
    });
    // もう一度 → 置き換え（2件にならない）
    const second = await h.req("/api/documents/d1/revision", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ instructions: "もう一度" }),
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ baseVersion: 1, provider: "anthropic" });

    const rows = await h.db
      .select()
      .from(schema.revisions)
      .where(eq(schema.revisions.documentId, "d1"));
    expect(rows).toHaveLength(1);

    // discard
    expect(
      (await h.req("/api/documents/d1/revision", { as: "u@example.com", method: "DELETE" })).status,
    ).toBe(200);
    const after = await h.db
      .select()
      .from(schema.revisions)
      .where(eq(schema.revisions.documentId, "d1"));
    expect(after).toHaveLength(0);
  });
});
