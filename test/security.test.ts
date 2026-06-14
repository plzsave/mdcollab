import { describe, it, expect } from "vitest";
import { makeHarness, seedMember, type Harness } from "./helpers/harness";
import * as schema from "../src/db/schema";
import { LIMITS } from "../src/limits";

// #8 入力サイズ上限 + #9/CSRF まわりのセキュリティ保証。

async function member(): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  await h.db
    .insert(schema.documents)
    .values({ id: "d1", title: "Doc", version: 1, createdBy: "u@example.com" });
  await h.db.insert(schema.folders).values({ id: "f1", name: "F", createdBy: "u@example.com" });
  return h;
}

describe("入力サイズ上限 (#8)", () => {
  it("本文がフィールド上限を超えると 400（bodyLimit 未満でもハンドラが弾く）", async () => {
    const h = await member();
    const content = "x".repeat(LIMITS.docContent + 1); // bodyBytes 未満・docContent 超過
    const res = await h.req("/api/documents/d1", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ content }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("上限ちょうどは通る（境界値）", async () => {
    const h = await member();
    const content = "x".repeat(LIMITS.docContent);
    const res = await h.req("/api/documents/d1", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ content }),
    });
    expect(res.status).toBe(200);
  });

  it("タイトル超過は作成時に 400", async () => {
    const h = await member();
    const res = await h.req("/api/documents", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ title: "t".repeat(LIMITS.title + 1) }),
    });
    expect(res.status).toBe(400);
  });

  it("フォルダ名超過は 400", async () => {
    const h = await member();
    const res = await h.req("/api/folders", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ name: "n".repeat(LIMITS.folderName + 1) }),
    });
    expect(res.status).toBe(400);
  });

  it("スレッド作成のコメント本文超過は 400", async () => {
    const h = await member();
    const res = await h.req("/api/documents/d1/threads", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ anchorText: "a", firstComment: "c".repeat(LIMITS.commentBody + 1) }),
    });
    expect(res.status).toBe(400);
  });

  it("ボディ総量が bodyBytes を超えると 413（粗い DoS バックストップ）", async () => {
    const h = await member();
    const body = "x".repeat(LIMITS.bodyBytes + 100);
    const res = await h.req("/api/documents/d1", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ content: body }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });
});

describe("セッション Cookie の属性 (CSRF / 盗用対策)", () => {
  it("dev-login の Set-Cookie は HttpOnly かつ SameSite=Lax", async () => {
    const h = await makeHarness({ devAuth: true });
    const res = await h.app.request("/api/auth/dev-login?email=u@example.com");
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie.toLowerCase()).toContain("path=/");
  });
});
