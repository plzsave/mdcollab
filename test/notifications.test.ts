import { describe, it, expect } from "vitest";
import { makeHarness, seedMember, type Harness } from "./helpers/harness";
import * as schema from "../src/db/schema";

async function setup(): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  await seedMember(h, "other@example.com", "member");
  await h.db.insert(schema.notifications).values([
    { id: "n1", recipient: "u@example.com", type: "mention" },
    { id: "n2", recipient: "u@example.com", type: "reply" },
    { id: "n3", recipient: "other@example.com", type: "mention" },
  ]);
  return h;
}

describe("/api/notifications", () => {
  it("GET は本人宛のみ返す", async () => {
    const h = await setup();
    const rows = (await (await h.req("/api/notifications", { as: "u@example.com" })).json()) as {
      id: string;
    }[];
    expect(rows.map((r) => r.id).sort()).toEqual(["n1", "n2"]);
  });

  it(":id/read は本人宛のみ既読化・他人のは 404", async () => {
    const h = await setup();
    expect(
      (await h.req("/api/notifications/n1/read", { as: "u@example.com", method: "POST" })).status,
    ).toBe(200);
    // 他人(other)の n3 を u が既読化しようとしても 404
    expect(
      (await h.req("/api/notifications/n3/read", { as: "u@example.com", method: "POST" })).status,
    ).toBe(404);

    const rows = await h.db.select().from(schema.notifications);
    expect(rows.find((r) => r.id === "n1")!.isRead).toBe(true);
    expect(rows.find((r) => r.id === "n3")!.isRead).toBe(false);
  });

  it("read-all は本人宛を全部既読化（他人は触らない）", async () => {
    const h = await setup();
    expect(
      (await h.req("/api/notifications/read-all", { as: "u@example.com", method: "POST" })).status,
    ).toBe(200);
    const rows = await h.db.select().from(schema.notifications);
    expect(rows.filter((r) => r.recipient === "u@example.com").every((r) => r.isRead)).toBe(true);
    expect(rows.find((r) => r.id === "n3")!.isRead).toBe(false);
  });

  it("未ログインは 401", async () => {
    const h = await setup();
    expect((await h.req("/api/notifications")).status).toBe(401);
  });
});
