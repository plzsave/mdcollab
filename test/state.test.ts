import { describe, it, expect } from "vitest";
import { makeHarness, seedMember } from "./helpers/harness";
import * as schema from "../src/db/schema";

describe("GET /api/state", () => {
  it("未ログインは 401", async () => {
    const h = await makeHarness();
    expect((await h.req("/api/state")).status).toBe(401);
  });

  it("ブートストラップ束を返し通知は本人宛のみ", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner", "Owner");
    await seedMember(h, "other@example.com", "member");
    await h.db.insert(schema.folders).values({ id: "f1", name: "F", createdBy: "o@example.com" });
    await h.db.insert(schema.statuses).values({ id: "s1", label: "Draft", sortOrder: 0 });
    await h.db.insert(schema.notifications).values([
      { id: "n1", recipient: "o@example.com", type: "mention" },
      { id: "n2", recipient: "other@example.com", type: "mention" },
    ]);

    const res = await h.req("/api/state", { as: "o@example.com" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      currentUser: { email: string; role: string };
      members: unknown[];
      folders: unknown[];
      statuses: unknown[];
      notifications: { id: string }[];
    };
    expect(body.currentUser).toMatchObject({ email: "o@example.com", role: "owner" });
    expect(body.members).toHaveLength(2);
    expect(body.folders).toHaveLength(1);
    expect(body.statuses).toHaveLength(1);
    // 自分宛(n1)だけ
    expect(body.notifications.map((n) => n.id)).toEqual(["n1"]);
  });

  it("aiSettings を束ね込み・平文キーは含まない", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    await h.req("/api/ai/settings", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ provider: "anthropic", model: "m", apiKey: "sk-bundle-secret" }),
    });

    const body = (await (await h.req("/api/state", { as: "u@example.com" })).json()) as {
      aiSettings: { provider: string | null; keys: Record<string, boolean> };
    };
    expect(body.aiSettings).toMatchObject({ provider: "anthropic", keys: { anthropic: true } });
    // 平文キーは state にも漏れない
    expect(JSON.stringify(body)).not.toContain("sk-bundle-secret");
  });
});
