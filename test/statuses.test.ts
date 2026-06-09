import { describe, it, expect } from "vitest";
import { makeHarness, seedMember } from "./helpers/harness";

describe("GET/PUT /api/statuses", () => {
  it("401 未ログイン / 403 非メンバー", async () => {
    const h = await makeHarness();
    expect((await h.req("/api/statuses")).status).toBe(401);
    expect((await h.req("/api/statuses", { as: "stranger@example.com" })).status).toBe(403);
  });

  it("member は GET 可・初期は空配列", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    const res = await h.req("/api/statuses", { as: "u@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("owner の PUT で一括置換し sortOrder 昇順で返る", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner");
    const res = await h.req("/api/statuses", {
      as: "o@example.com",
      method: "PUT",
      body: JSON.stringify([
        { label: "Done", sortOrder: 2 },
        { label: "Draft", sortOrder: 0 },
        { label: "Review", sortOrder: 1 },
      ]),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { label: string; sortOrder: number }[];
    expect(rows.map((r) => r.label)).toEqual(["Draft", "Review", "Done"]);

    // GET にも反映
    const got = (await (await h.req("/api/statuses", { as: "o@example.com" })).json()) as unknown[];
    expect(got).toHaveLength(3);
  });

  it("PUT は前回分を完全に置換する", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner");
    const put = (body: unknown) =>
      h.req("/api/statuses", { as: "o@example.com", method: "PUT", body: JSON.stringify(body) });
    await put([{ label: "A" }, { label: "B" }]);
    await put([{ label: "C" }]);
    const got = (await (await h.req("/api/statuses", { as: "o@example.com" })).json()) as {
      label: string;
    }[];
    expect(got.map((r) => r.label)).toEqual(["C"]);
  });

  it("member の PUT は 403", async () => {
    const h = await makeHarness();
    await seedMember(h, "m@example.com", "member");
    const res = await h.req("/api/statuses", {
      as: "m@example.com",
      method: "PUT",
      body: JSON.stringify([{ label: "X" }]),
    });
    expect(res.status).toBe(403);
  });

  it("不正な body は 400（配列でない / label 欠落）", async () => {
    const h = await makeHarness();
    await seedMember(h, "o@example.com", "owner");
    const notArray = await h.req("/api/statuses", {
      as: "o@example.com",
      method: "PUT",
      body: JSON.stringify({ label: "X" }),
    });
    expect(notArray.status).toBe(400);
    const noLabel = await h.req("/api/statuses", {
      as: "o@example.com",
      method: "PUT",
      body: JSON.stringify([{ sortOrder: 0 }]),
    });
    expect(noLabel.status).toBe(400);
  });
});
