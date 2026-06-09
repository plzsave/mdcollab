import { describe, it, expect } from "vitest";
import { makeHarness, seedMember } from "./helpers/harness";

describe("/api/members", () => {
  it("401 未ログイン / 403 非メンバー", async () => {
    const h = await makeHarness();
    expect((await h.req("/api/members")).status).toBe(401);
    expect((await h.req("/api/members", { as: "stranger@example.com" })).status).toBe(403);
  });

  it("member は一覧 GET 可", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner");
    await seedMember(h, "m@example.com", "member");
    const res = await h.req("/api/members", { as: "m@example.com" });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { email: string }[];
    expect(rows.map((r) => r.email)).toEqual(["m@example.com", "o@example.com"]);
  });

  it("owner は追加でき role=member・addedBy が記録される", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner");
    const res = await h.req("/api/members", {
      as: "o@example.com",
      method: "POST",
      body: JSON.stringify({ email: "new@example.com", displayName: "New" }),
    });
    expect(res.status).toBe(201);
    const m = (await res.json()) as { email: string; role: string; addedBy: string };
    expect(m).toMatchObject({ email: "new@example.com", role: "member", addedBy: "o@example.com" });
  });

  it("member の追加は 403", async () => {
    const h = await makeHarness();
    await seedMember(h, "m@example.com", "member");
    const res = await h.req("/api/members", {
      as: "m@example.com",
      method: "POST",
      body: JSON.stringify({ email: "x@example.com", displayName: "X" }),
    });
    expect(res.status).toBe(403);
  });

  it("必須欠落は 400 / 重複は 409", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner");
    const bad = await h.req("/api/members", {
      as: "o@example.com",
      method: "POST",
      body: JSON.stringify({ email: "x@example.com" }),
    });
    expect(bad.status).toBe(400);
    const dup = await h.req("/api/members", {
      as: "o@example.com",
      method: "POST",
      body: JSON.stringify({ email: "o@example.com", displayName: "dup" }),
    });
    expect(dup.status).toBe(409);
  });

  it("PATCH で displayName と role を更新できる", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner");
    await seedMember(h, "m@example.com", "member");
    const res = await h.req("/api/members/m@example.com", {
      as: "o@example.com",
      method: "PATCH",
      body: JSON.stringify({ displayName: "Renamed", role: "owner" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: "Renamed", role: "owner" });
  });

  it("PATCH 対象なしは 404 / 変更なしは 400", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner");
    expect(
      (
        await h.req("/api/members/none@example.com", {
          as: "o@example.com",
          method: "PATCH",
          body: JSON.stringify({ displayName: "x" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.req("/api/members/o@example.com", {
          as: "o@example.com",
          method: "PATCH",
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(400);
  });

  it("最後の owner の降格・削除は 400（締め出し防止）", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner");
    const demote = await h.req("/api/members/o@example.com", {
      as: "o@example.com",
      method: "PATCH",
      body: JSON.stringify({ role: "member" }),
    });
    expect(demote.status).toBe(400);
    const del = await h.req("/api/members/o@example.com", {
      as: "o@example.com",
      method: "DELETE",
    });
    expect(del.status).toBe(400);
  });

  it("DELETE でメンバーを削除できる（owner が2人なら owner も可）", async () => {
    const h = await makeHarness();
    await seedMember(h, "o1@example.com", "owner");
    await seedMember(h, "o2@example.com", "owner");
    await seedMember(h, "m@example.com", "member");
    expect(
      (await h.req("/api/members/m@example.com", { as: "o1@example.com", method: "DELETE" })).status,
    ).toBe(200);
    expect(
      (await h.req("/api/members/o2@example.com", { as: "o1@example.com", method: "DELETE" }))
        .status,
    ).toBe(200);
    const rows = (await (await h.req("/api/members", { as: "o1@example.com" })).json()) as unknown[];
    expect(rows).toHaveLength(1);
  });
});
