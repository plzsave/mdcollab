import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeHarness, seedMember, type Harness } from "./helpers/harness";
import * as schema from "../src/db/schema";
import { encryptSecret, decryptSecret } from "../src/crypto";

async function asMember(): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  return h;
}

describe("crypto", () => {
  it("AES-GCM ラウンドトリップ・暗号文は平文と異なる", async () => {
    const enc = await encryptSecret("sk-secret-123", "key");
    expect(enc).not.toContain("sk-secret-123");
    expect(await decryptSecret(enc, "key")).toBe("sk-secret-123");
  });
  it("毎回 IV が変わるので同じ平文でも暗号文は異なる", async () => {
    const a = await encryptSecret("x", "key");
    const b = await encryptSecret("x", "key");
    expect(a).not.toBe(b);
  });
});

describe("/api/ai/settings", () => {
  it("初期は空・PUT で provider/model 設定、キーは暗号化保存され平文は返らない", async () => {
    const h = await asMember();
    expect(await (await h.req("/api/ai/settings", { as: "u@example.com" })).json()).toMatchObject({
      provider: null,
      keys: {},
      githubPats: [],
    });

    const res = await h.req("/api/ai/settings", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ provider: "anthropic", model: "claude-x", apiKey: "sk-test-123" }),
    });
    const view = await res.json();
    expect(view).toMatchObject({ provider: "anthropic", model: "claude-x", keys: { anthropic: true } });
    // 平文キーはレスポンスに含まれない
    expect(JSON.stringify(view)).not.toContain("sk-test-123");

    // DB には暗号化されて入っている（平文ではない・復号で戻る）
    const [row] = await h.db
      .select()
      .from(schema.aiKeys)
      .where(eq(schema.aiKeys.email, "u@example.com"));
    expect(row!.encryptedKey).not.toContain("sk-test-123");
    expect(await decryptSecret(row!.encryptedKey, h.config.encryptionKey)).toBe("sk-test-123");
  });

  it("provider 欠落は 400", async () => {
    const h = await asMember();
    const res = await h.req("/api/ai/settings", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ model: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("キー削除でき、models はキーがある時だけ取れる", async () => {
    const h = await asMember();
    // キー無し → 400
    expect(
      (await h.req("/api/ai/models?provider=anthropic", { as: "u@example.com" })).status,
    ).toBe(400);

    await h.req("/api/ai/settings", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ provider: "anthropic", model: "claude-x", apiKey: "sk-test-123" }),
    });
    const models = await (
      await h.req("/api/ai/models?provider=anthropic", { as: "u@example.com" })
    ).json();
    expect(models).toEqual({ models: ["anthropic-model-a", "anthropic-model-b"] });

    // 削除 → keys が空に
    const after = await (
      await h.req("/api/ai/keys/anthropic", { as: "u@example.com", method: "DELETE" })
    ).json();
    expect(after.keys).toEqual({});
  });

  it("GitHub PAT/Repo の保存・削除", async () => {
    const h = await asMember();
    let view = await (
      await h.req("/api/ai/github/pat", {
        as: "u@example.com",
        method: "PUT",
        body: JSON.stringify({ scope: "default", pat: "ghp_xxx" }),
      })
    ).json();
    expect(view.githubPats).toEqual(["default"]);
    expect(JSON.stringify(view)).not.toContain("ghp_xxx");

    view = await (
      await h.req("/api/ai/github/repo", {
        as: "u@example.com",
        method: "PUT",
        body: JSON.stringify({ repo: "owner/repo" }),
      })
    ).json();
    expect(view.githubRepo).toBe("owner/repo");

    view = await (
      await h.req("/api/ai/github/pat?scope=default", { as: "u@example.com", method: "DELETE" })
    ).json();
    expect(view.githubPats).toEqual([]);
  });

  it("未ログインは 401", async () => {
    const h = await asMember();
    expect((await h.req("/api/ai/settings")).status).toBe(401);
  });
});
