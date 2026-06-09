import { describe, it, expect } from "vitest";
import { makeHarness, seedMember } from "./helpers/harness";
import * as schema from "../src/db/schema";

describe("POST /api/setup", () => {
  it("初回(members 空): 本人を owner 登録＋既定ステータス投入", async () => {
    const h = await makeHarness();
    const res = await h.req("/api/setup", {
      as: "first@example.com",
      method: "POST",
      body: JSON.stringify({ displayName: "First Owner" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, bootstrapped: true });

    const mem = await h.db.select().from(schema.members);
    expect(mem).toHaveLength(1);
    expect(mem[0]).toMatchObject({ email: "first@example.com", role: "owner" });
    const st = await h.db.select().from(schema.statuses);
    expect(st.map((s) => s.id).sort()).toEqual(["done", "draft", "review"]);
  });

  it("2回目(owner): bootstrapped=false で冪等", async () => {
    const h = await makeHarness();
    await h.req("/api/setup", { as: "first@example.com", method: "POST", body: "{}" });
    const again = await h.req("/api/setup", { as: "first@example.com", method: "POST", body: "{}" });
    expect(await again.json()).toEqual({ ok: true, bootstrapped: false });
    // ステータスは重複しない
    expect(await h.db.select().from(schema.statuses)).toHaveLength(3);
  });

  it("members 存在後に非 owner が叩くと 403", async () => {
    const h = await makeHarness();
    await seedMember(h, "owner@example.com", "owner");
    const res = await h.req("/api/setup", { as: "stranger@example.com", method: "POST", body: "{}" });
    expect(res.status).toBe(403);
  });

  it("未ログインは 401", async () => {
    const h = await makeHarness();
    expect((await h.req("/api/setup", { method: "POST", body: "{}" })).status).toBe(401);
  });
});
