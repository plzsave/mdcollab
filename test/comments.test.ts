import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeHarness, seedMember, type Harness } from "./helpers/harness";
import * as schema from "../src/db/schema";

// u(作成者) と b(同僚) の2メンバー + 文書 d1 を用意する。
async function setup(): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  await seedMember(h, "b@example.com", "member");
  await h.db
    .insert(schema.documents)
    .values({ id: "d1", title: "Doc", version: 1, createdBy: "u@example.com" });
  return h;
}

async function notifsOf(h: Harness, email: string) {
  return (await (await h.req("/api/notifications", { as: email })).json()) as {
    type: string;
    threadId: string | null;
  }[];
}

describe("Threads / Comments", () => {
  it("スレッド作成: 初コメント同梱・mention に通知", async () => {
    const h = await setup();
    const res = await h.req("/api/documents/d1/threads", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ anchorText: "ここ", firstComment: "確認お願い", mentions: ["b@example.com"] }),
    });
    expect(res.status).toBe(201);
    const t = (await res.json()) as { id: string; comments: { content: string }[] };
    expect(t.comments[0]!.content).toBe("確認お願い");

    // b に mention 通知、作成者 u には通知なし（actor 除外）
    expect((await notifsOf(h, "b@example.com")).map((n) => n.type)).toEqual(["mention"]);
    expect(await notifsOf(h, "u@example.com")).toHaveLength(0);
  });

  it("バリデーション/存在: 400・404", async () => {
    const h = await setup();
    expect(
      (
        await h.req("/api/documents/d1/threads", {
          as: "u@example.com",
          method: "POST",
          body: JSON.stringify({ anchorText: "x" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.req("/api/documents/none/threads", {
          as: "u@example.com",
          method: "POST",
          body: JSON.stringify({ anchorText: "x", firstComment: "y" }),
        })
      ).status,
    ).toBe(404);
  });

  it("一覧 GET: スレッドにコメントを同梱", async () => {
    const h = await setup();
    await h.req("/api/documents/d1/threads", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ anchorText: "a", firstComment: "c1" }),
    });
    const list = (await (
      await h.req("/api/documents/d1/threads", { as: "u@example.com" })
    ).json()) as { comments: unknown[] }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.comments).toHaveLength(1);
  });

  it("返信: 参加者に reply 通知（actor は除外）", async () => {
    const h = await setup();
    const t = (await (
      await h.req("/api/documents/d1/threads", {
        as: "u@example.com",
        method: "POST",
        body: JSON.stringify({ anchorText: "a", firstComment: "c1" }),
      })
    ).json()) as { id: string };

    const reply = await h.req(`/api/threads/${t.id}/comments`, {
      as: "b@example.com",
      method: "POST",
      body: JSON.stringify({ content: "返信です" }),
    });
    expect(reply.status).toBe(201);

    // 作成者 u に reply 通知、返信者 b 自身には来ない
    expect((await notifsOf(h, "u@example.com")).map((n) => n.type)).toContain("reply");
    expect(await notifsOf(h, "b@example.com")).toHaveLength(0);
  });

  it("返信で mention された人は mention のみ（reply と二重にしない）", async () => {
    const h = await setup();
    const t = (await (
      await h.req("/api/documents/d1/threads", {
        as: "u@example.com",
        method: "POST",
        body: JSON.stringify({ anchorText: "a", firstComment: "c1" }),
      })
    ).json()) as { id: string };
    await h.req(`/api/threads/${t.id}/comments`, {
      as: "b@example.com",
      method: "POST",
      body: JSON.stringify({ content: "@u 確認", mentions: ["u@example.com"] }),
    });
    const types = (await notifsOf(h, "u@example.com")).map((n) => n.type);
    expect(types).toContain("mention");
    expect(types).not.toContain("reply");
  });

  it("editComment は著者のみ・論理削除後は一覧から消える", async () => {
    const h = await setup();
    const t = (await (
      await h.req("/api/documents/d1/threads", {
        as: "u@example.com",
        method: "POST",
        body: JSON.stringify({ anchorText: "a", firstComment: "c1" }),
      })
    ).json()) as { id: string; comments: { id: string }[] };
    const cid = t.comments[0]!.id;

    // 他人は編集不可
    expect(
      (
        await h.req(`/api/comments/${cid}`, {
          as: "b@example.com",
          method: "PATCH",
          body: JSON.stringify({ content: "改ざん" }),
        })
      ).status,
    ).toBe(403);
    // 著者は編集可
    const edited = await h.req(`/api/comments/${cid}`, {
      as: "u@example.com",
      method: "PATCH",
      body: JSON.stringify({ content: "修正済み" }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ content: "修正済み" });

    // 著者が論理削除 → 一覧から消える、DB 上は deleted=true
    expect(
      (await h.req(`/api/comments/${cid}`, { as: "u@example.com", method: "DELETE" })).status,
    ).toBe(200);
    const list = (await (
      await h.req("/api/documents/d1/threads", { as: "u@example.com" })
    ).json()) as { comments: unknown[] }[];
    expect(list[0]!.comments).toHaveLength(0);
    const raw = await h.db.select().from(schema.comments).where(eq(schema.comments.id, cid));
    expect(raw[0]!.deleted).toBe(true);
  });

  it("resolve → resolved + 参加者通知 / reopen → open", async () => {
    const h = await setup();
    const t = (await (
      await h.req("/api/documents/d1/threads", {
        as: "u@example.com",
        method: "POST",
        body: JSON.stringify({ anchorText: "a", firstComment: "c1" }),
      })
    ).json()) as { id: string };
    // b が返信して「参加者」になる（resolve 通知の対象は参加者＝作成者＋コメント者）
    await h.req(`/api/threads/${t.id}/comments`, {
      as: "b@example.com",
      method: "POST",
      body: JSON.stringify({ content: "対応しました" }),
    });

    const resolved = await h.req(`/api/threads/${t.id}/resolve`, {
      as: "u@example.com",
      method: "POST",
    });
    expect(resolved.status).toBe(200);
    let row = (await h.db.select().from(schema.threads).where(eq(schema.threads.id, t.id)))[0]!;
    expect(row.status).toBe("resolved");
    expect(row.resolvedBy).toBe("u@example.com");
    expect((await notifsOf(h, "b@example.com")).map((n) => n.type)).toContain("resolve");

    await h.req(`/api/threads/${t.id}/reopen`, { as: "u@example.com", method: "POST" });
    row = (await h.db.select().from(schema.threads).where(eq(schema.threads.id, t.id)))[0]!;
    expect(row.status).toBe("open");
    expect(row.resolvedAt).toBeNull();
  });
});
