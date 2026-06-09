import { describe, it, expect } from "vitest";
import { makeHarness, seedMember } from "./helpers/harness";

describe("/api/folders", () => {
  it("401 未ログイン / 403 非メンバー", async () => {
    const h = await makeHarness();
    expect((await h.req("/api/folders")).status).toBe(401);
    expect((await h.req("/api/folders", { as: "stranger@example.com" })).status).toBe(403);
  });

  it("初期は空・作成すると 201 で返り GET に出る", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");

    expect(await (await h.req("/api/folders", { as: "u@example.com" })).json()).toEqual([]);

    const created = await h.req("/api/folders", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ name: "設計メモ" }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ name: "設計メモ", createdBy: "u@example.com" });

    const list = (await (await h.req("/api/folders", { as: "u@example.com" })).json()) as {
      name: string;
    }[];
    expect(list.map((f) => f.name)).toEqual(["設計メモ"]);
  });

  it("name 欠落は 400", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    const res = await h.req("/api/folders", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
