import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeHarness, seedMember, type Harness } from "./helpers/harness";
import * as schema from "../src/db/schema";

// createDocument は未実装(Phase 1)なので、テストでは直接 DB+ストアに種を蒔く。
async function seedDoc(h: Harness, id: string, content: string) {
  const key = await h.store.put(id, 1, content);
  await h.db
    .insert(schema.documents)
    .values({ id, title: id, storageKey: key, version: 1, createdBy: "u@example.com" });
  return key;
}

describe("/api/documents/:id", () => {
  it("GET は本体(ストア)を読んで返す・無いと 404", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    await seedDoc(h, "d1", "# v1\n本文");

    const res = await h.req("/api/documents/d1", { as: "u@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "d1", content: "# v1\n本文", version: 1 });

    expect((await h.req("/api/documents/none", { as: "u@example.com" })).status).toBe(404);
  });

  it("正しい If-Match で更新すると version が上がりストア/版履歴に反映", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    await seedDoc(h, "d1", "# v1");

    const res = await h.req("/api/documents/d1", {
      as: "u@example.com",
      method: "PUT",
      headers: { "If-Match": "1" },
      body: JSON.stringify({ content: "# v2" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "d1", version: 2 });

    // ストアに新 version の本体
    expect(h.store.dump().get("docs/d1/2.md")).toBe("# v2");
    // 版履歴に v2
    const vers = await h.db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, "d1"));
    expect(vers.map((v) => v.version)).toContain(2);
    // GET も新しい本体を返す
    expect(await (await h.req("/api/documents/d1", { as: "u@example.com" })).json()).toMatchObject({
      content: "# v2",
      version: 2,
    });
  });

  it("古い If-Match は 409 CONFLICT（楽観ロック）", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    await seedDoc(h, "d1", "# v1");

    // 1回更新して version=2 にする
    await h.req("/api/documents/d1", {
      as: "u@example.com",
      method: "PUT",
      headers: { "If-Match": "1" },
      body: JSON.stringify({ content: "# v2" }),
    });
    // もう一度 version=1 を期待して更新 → 衝突
    const conflict = await h.req("/api/documents/d1", {
      as: "u@example.com",
      method: "PUT",
      headers: { "If-Match": "1" },
      body: JSON.stringify({ content: "# 衝突" }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "CONFLICT" }, current: 2 });
  });

  it("content 欠落は 400", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    await seedDoc(h, "d1", "# v1");
    const res = await h.req("/api/documents/d1", {
      as: "u@example.com",
      method: "PUT",
      headers: { "If-Match": "1" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
