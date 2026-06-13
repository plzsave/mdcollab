import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeHarness, seedMember, type Harness } from "./helpers/harness";
import * as schema from "../src/db/schema";

async function asMember(): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  return h;
}

async function createDoc(h: Harness, body: Record<string, unknown>) {
  return h.req("/api/documents", {
    as: "u@example.com",
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/documents（作成）", () => {
  it("作成すると version=1・空本文で返り GET できる", async () => {
    const h = await asMember();
    const res = await createDoc(h, { title: "新規" });
    expect(res.status).toBe(201);
    const doc = (await res.json()) as { id: string; title: string; version: number };
    expect(doc).toMatchObject({ title: "新規", version: 1 });

    const got = await h.req(`/api/documents/${doc.id}`, { as: "u@example.com" });
    expect(await got.json()).toMatchObject({ id: doc.id, content: "", version: 1 });
  });

  it("検索用 body 列が作成時の本文と同期される", async () => {
    const h = await asMember();
    const doc = (await (await createDoc(h, { title: "T", content: "# 見出し\n本文テキスト" })).json()) as {
      id: string;
    };
    const [row] = await h.db
      .select({ body: schema.documents.body })
      .from(schema.documents)
      .where(eq(schema.documents.id, doc.id));
    expect(row!.body).toBe("# 見出し\n本文テキスト");
  });

  it("更新時に body 列も新本文へ同期される", async () => {
    const h = await asMember();
    const doc = (await (await createDoc(h, { title: "T", content: "旧本文" })).json()) as { id: string };
    await h.req(`/api/documents/${doc.id}`, {
      as: "u@example.com",
      method: "PUT",
      headers: { "If-Match": '"1"' },
      body: JSON.stringify({ content: "新本文" }),
    });
    const [row] = await h.db
      .select({ body: schema.documents.body })
      .from(schema.documents)
      .where(eq(schema.documents.id, doc.id));
    expect(row!.body).toBe("新本文");
  });

  it("title 欠落は 400 / 未知の folderId は 400", async () => {
    const h = await asMember();
    expect((await createDoc(h, {})).status).toBe(400);
    expect((await createDoc(h, { title: "X", folderId: "nope" })).status).toBe(400);
  });

  it("実在フォルダなら作成でき一覧に出る", async () => {
    const h = await asMember();
    await h.db.insert(schema.folders).values({ id: "f1", name: "F", createdBy: "u@example.com" });
    const a = (await (await createDoc(h, { title: "A", folderId: "f1" })).json()) as { id: string };
    await createDoc(h, { title: "B", folderId: "f1" });

    const list = await h.req("/api/folders/f1/documents", { as: "u@example.com" });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: string; title: string; content?: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveProperty("content"); // 一覧は本文を含めない
    expect(rows.map((r) => r.title).sort()).toEqual(["A", "B"]);
    expect(rows.some((r) => r.id === a.id)).toBe(true);
  });
});

describe("PATCH /api/documents/:id（status/archived/assignee 統合）", () => {
  it("statusId/archived/assignee を部分更新できる", async () => {
    const h = await asMember();
    await h.db.insert(schema.statuses).values({ id: "s1", label: "Review", sortOrder: 0 });
    const doc = (await (await createDoc(h, { title: "T" })).json()) as { id: string };

    const res = await h.req(`/api/documents/${doc.id}`, {
      as: "u@example.com",
      method: "PATCH",
      body: JSON.stringify({ statusId: "s1", archived: true, assignee: "u@example.com" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      statusId: "s1",
      archived: true,
      assignee: "u@example.com",
    });
  });

  it("未知 statusId は 400 / 空 body は 400 / 無い文書は 404", async () => {
    const h = await asMember();
    const doc = (await (await createDoc(h, { title: "T" })).json()) as { id: string };
    expect(
      (
        await h.req(`/api/documents/${doc.id}`, {
          as: "u@example.com",
          method: "PATCH",
          body: JSON.stringify({ statusId: "ghost" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.req(`/api/documents/${doc.id}`, {
          as: "u@example.com",
          method: "PATCH",
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.req("/api/documents/none", {
          as: "u@example.com",
          method: "PATCH",
          body: JSON.stringify({ archived: true }),
        })
      ).status,
    ).toBe(404);
  });
});

describe("DELETE /api/documents/:id", () => {
  it("版を作ってからでも削除でき本体ストアも掃除される", async () => {
    const h = await asMember();
    const doc = (await (await createDoc(h, { title: "T", content: "# v1" })).json()) as {
      id: string;
    };
    // 1回更新して version2 と版履歴・ストア鍵を増やす
    await h.req(`/api/documents/${doc.id}`, {
      as: "u@example.com",
      method: "PUT",
      headers: { "If-Match": "1" },
      body: JSON.stringify({ content: "# v2" }),
    });
    expect(h.store.dump().size).toBeGreaterThan(0);

    const del = await h.req(`/api/documents/${doc.id}`, { as: "u@example.com", method: "DELETE" });
    expect(del.status).toBe(200);

    // メタも版履歴も消え、GET は 404
    expect((await h.req(`/api/documents/${doc.id}`, { as: "u@example.com" })).status).toBe(404);
    const vers = await h.db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, doc.id));
    expect(vers).toHaveLength(0);
    // 本体ストアも空
    expect(h.store.dump().size).toBe(0);
  });

  it("無い文書の削除は 404", async () => {
    const h = await asMember();
    expect(
      (await h.req("/api/documents/none", { as: "u@example.com", method: "DELETE" })).status,
    ).toBe(404);
  });
});

describe("GET /api/documents/:id?include=threads,revision（バンドル）", () => {
  it("include 指定で threads とコメント・pendingRevision を同梱", async () => {
    const h = await asMember();
    const doc = (await (await createDoc(h, { title: "T" })).json()) as { id: string };
    await h.db.insert(schema.threads).values({
      id: "t1",
      documentId: doc.id,
      anchorText: "ここ",
      createdBy: "u@example.com",
    });
    await h.db
      .insert(schema.comments)
      .values({ id: "c1", threadId: "t1", content: "コメント", author: "u@example.com" });
    await h.db.insert(schema.revisions).values({
      id: "r1",
      documentId: doc.id,
      createdBy: "u@example.com",
      content: "AI改稿案",
      baseVersion: 1,
    });

    const res = await h.req(`/api/documents/${doc.id}?include=threads,revision`, {
      as: "u@example.com",
    });
    const body = (await res.json()) as {
      threads: { id: string; comments: { id: string }[] }[];
      pendingRevision: { id: string } | null;
    };
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]!.comments.map((c) => c.id)).toEqual(["c1"]);
    expect(body.pendingRevision?.id).toBe("r1");
  });

  it("include なしなら threads/pendingRevision は含めない", async () => {
    const h = await asMember();
    const doc = (await (await createDoc(h, { title: "T" })).json()) as { id: string };
    const body = (await (
      await h.req(`/api/documents/${doc.id}`, { as: "u@example.com" })
    ).json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("threads");
    expect(body).not.toHaveProperty("pendingRevision");
  });

  it("pendingRevision は本人分のみ", async () => {
    const h = await asMember();
    await seedMember(h, "other@example.com", "member");
    const doc = (await (await createDoc(h, { title: "T" })).json()) as { id: string };
    await h.db.insert(schema.revisions).values({
      id: "r1",
      documentId: doc.id,
      createdBy: "other@example.com",
      content: "他人の案",
      baseVersion: 1,
    });
    const body = (await (
      await h.req(`/api/documents/${doc.id}?include=revision`, { as: "u@example.com" })
    ).json()) as { pendingRevision: unknown };
    expect(body.pendingRevision).toBeNull();
  });
});

describe("POST /api/documents/import", () => {
  it("複数ファイルを取り込み、成否を per-file で返す", async () => {
    const h = await asMember();
    const res = await h.req("/api/documents/import", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({
        files: [
          { name: "設計.md", content: "# 設計" },
          { name: "memo.markdown", content: "メモ" },
          { name: "bad.md" }, // content 無し
        ],
      }),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { name: string; ok: boolean; docName?: string }[];
    expect(rows.map((r) => r.ok)).toEqual([true, true, false]);
    expect(rows[0]!.docName).toBe("設計"); // 拡張子を落としてタイトル化
    expect(rows[1]!.docName).toBe("memo");
  });

  it("files[] が無いと 400 / 上限超過は 400", async () => {
    const h = await asMember();
    expect(
      (
        await h.req("/api/documents/import", {
          as: "u@example.com",
          method: "POST",
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => ({ name: `${i}.md`, content: "x" }));
    expect(
      (
        await h.req("/api/documents/import", {
          as: "u@example.com",
          method: "POST",
          body: JSON.stringify({ files: many }),
        })
      ).status,
    ).toBe(400);
  });
});
