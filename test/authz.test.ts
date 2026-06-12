import { describe, it, expect } from "vitest";
import { makeHarness, seedMember } from "./helpers/harness";
import * as schema from "../src/db/schema";

// 認可・分離・エラー形式の横断テスト（個別ファイルの穴を埋め、不変条件を明示化する）。

// 各ルートグループの代表エンドポイント。requireMember はハンドラ前に走るので
// 文書等を seed せずとも「未ログイン=401 / 非メンバー=403」を検証できる。
const PROTECTED: { method: string; path: string }[] = [
  { method: "GET", path: "/api/state" },
  { method: "GET", path: "/api/folders" },
  { method: "GET", path: "/api/statuses" },
  { method: "GET", path: "/api/members" },
  { method: "GET", path: "/api/notifications" },
  { method: "GET", path: "/api/ai/settings" },
  { method: "GET", path: "/api/documents/d1" },
  { method: "GET", path: "/api/documents/d1/threads" },
  { method: "POST", path: "/api/documents/d1/threads" },
  { method: "GET", path: "/api/documents/d1/reviews" },
  { method: "POST", path: "/api/documents/d1/review" },
];

describe("認可マトリクス: 未ログイン401 / 非メンバー403", () => {
  for (const { method, path } of PROTECTED) {
    it(`${method} ${path}`, async () => {
      const h = await makeHarness();

      const unauth = await h.req(path, { method });
      expect(unauth.status).toBe(401);
      expect(await unauth.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });

      const forbidden = await h.req(path, { method, as: "stranger@example.com" });
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });
  }
});

describe("ユーザー間分離: AI 秘密は本人にしか見えない", () => {
  it("u のキーは b の settings に出ない / b は models 取得不可", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    await seedMember(h, "b@example.com", "member");

    await h.req("/api/ai/settings", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ provider: "anthropic", model: "m", apiKey: "sk-u-secret" }),
    });

    // b の視点では provider/キーは空（u の設定は漏れない）
    const bView = await (await h.req("/api/ai/settings", { as: "b@example.com" })).json();
    expect(bView).toMatchObject({ provider: null, keys: {} });
    expect(JSON.stringify(bView)).not.toContain("sk-u-secret");

    // b は anthropic キーを持たないので models は 400
    expect(
      (await h.req("/api/ai/models?provider=anthropic", { as: "b@example.com" })).status,
    ).toBe(400);
  });
});

describe("コメント削除は著者のみ", () => {
  it("非著者の DELETE は 403", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    await seedMember(h, "b@example.com", "member");
    await h.db
      .insert(schema.documents)
      .values({ id: "d1", title: "D", version: 1, createdBy: "u@example.com" });

    const t = (await (
      await h.req("/api/documents/d1/threads", {
        as: "u@example.com",
        method: "POST",
        body: JSON.stringify({ anchorText: "a", firstComment: "c1" }),
      })
    ).json()) as { comments: { id: string }[] };
    const cid = t.comments[0]!.id;

    const res = await h.req(`/api/comments/${cid}`, { as: "b@example.com", method: "DELETE" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});

describe("エラー形式の統一 {error:{code,message}}", () => {
  it("400(BAD_REQUEST) / 404(NOT_FOUND)", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");

    const bad = await h.req("/api/ai/settings", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({}), // provider 欠落
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "BAD_REQUEST", message: expect.any(String) } });

    const nf = await h.req("/api/documents/none", { as: "u@example.com" });
    expect(nf.status).toBe(404);
    expect(await nf.json()).toMatchObject({ error: { code: "NOT_FOUND", message: expect.any(String) } });
  });

  it("409(CONFLICT): 中身のあるフォルダ削除", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    const f = (await (
      await h.req("/api/folders", {
        as: "u@example.com",
        method: "POST",
        body: JSON.stringify({ name: "F" }),
      })
    ).json()) as { id: string };
    await h.db
      .insert(schema.documents)
      .values({ id: "d1", folderId: f.id, title: "D", version: 1, createdBy: "u@example.com" });

    const del = await h.req(`/api/folders/${f.id}`, { as: "u@example.com", method: "DELETE" });
    expect(del.status).toBe(409);
    expect(await del.json()).toMatchObject({ error: { code: "CONFLICT", message: expect.any(String) } });
  });
});
