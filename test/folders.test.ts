import { describe, it, expect } from "vitest";
import { makeHarness, seedMember } from "./helpers/harness";
import * as schema from "../src/db/schema";

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

  it("rename(PATCH): 改名でき、無い ID は 404", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    const f = (await (
      await h.req("/api/folders", {
        as: "u@example.com",
        method: "POST",
        body: JSON.stringify({ name: "旧名" }),
      })
    ).json()) as { id: string };

    const res = await h.req(`/api/folders/${f.id}`, {
      as: "u@example.com",
      method: "PATCH",
      body: JSON.stringify({ name: "新名" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: f.id, name: "新名" });

    expect(
      (
        await h.req("/api/folders/none", {
          as: "u@example.com",
          method: "PATCH",
          body: JSON.stringify({ name: "x" }),
        })
      ).status,
    ).toBe(404);
  });

  it("delete: 空なら削除でき、中身があると 409", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    const f = (await (
      await h.req("/api/folders", {
        as: "u@example.com",
        method: "POST",
        body: JSON.stringify({ name: "F" }),
      })
    ).json()) as { id: string };

    // 空 → 200
    expect(
      (await h.req(`/api/folders/${f.id}`, { as: "u@example.com", method: "DELETE" })).status,
    ).toBe(200);

    // 文書を含むフォルダ → 409
    const f2 = (await (
      await h.req("/api/folders", {
        as: "u@example.com",
        method: "POST",
        body: JSON.stringify({ name: "F2" }),
      })
    ).json()) as { id: string };
    await h.db
      .insert(schema.documents)
      .values({ id: "d1", folderId: f2.id, title: "T", version: 1, createdBy: "u@example.com" });
    expect(
      (await h.req(`/api/folders/${f2.id}`, { as: "u@example.com", method: "DELETE" })).status,
    ).toBe(409);
  });
});
