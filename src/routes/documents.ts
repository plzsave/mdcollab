import { Hono } from "hono";
import { and, eq, inArray, desc } from "drizzle-orm";
import type { Deps } from "../env";
import { requireMember, type Vars } from "../auth/middleware";
import {
  documents,
  documentVersions,
  threads,
  comments,
  revisions,
  statuses,
  folders,
} from "../db/schema";

// 1ファイルあたりのインポート上限（旧 MAX_IMPORT_FILES 踏襲）。
const MAX_IMPORT_FILES = 50;

// 本文の拡張子を落としてタイトル化（旧 importDocuments のファイル名→docName 相当）。
function titleFromFilename(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "").trim() || name;
}

// 本体ストアへ初版を書き、ref を (A)storageKey / (B)driveFileId に振り分ける。
async function writeInitial(deps: Deps, id: string, content: string) {
  const ref = await deps.store.put(id, 1, content);
  const isS3 = deps.store.backend === "s3";
  return { storageKey: isS3 ? ref : null, driveFileId: isS3 ? null : ref, ref };
}

// 1ドキュメント作成（POST / と import で共用）。
async function createDoc(
  deps: Deps,
  args: { folderId: string | null; title: string; content: string; createdBy: string },
) {
  const id = crypto.randomUUID();
  const { storageKey, driveFileId } = await writeInitial(deps, id, args.content);
  const rows = await deps.db
    .insert(documents)
    .values({
      id,
      folderId: args.folderId,
      title: args.title,
      body: args.content, // 検索用に本文コピーを同期（本体は store 側）
      storageKey,
      driveFileId,
      version: 1,
      createdBy: args.createdBy,
    })
    .returning();
  await deps.db
    .insert(documentVersions)
    .values({ documentId: id, version: 1, storageKey, driveFileId, createdBy: args.createdBy });
  return rows[0]!;
}

export function documentsRoutes(deps: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", requireMember(deps));

  // POST /api/documents ≈ createDocument。body {folderId?, title}
  app.post("/", async (c) => {
    const email = c.get("email");
    const body = await c.req
      .json<{ folderId?: string; title?: string; content?: string }>()
      .catch(() => ({}) as { folderId?: string; title?: string; content?: string });
    if (!body.title) {
      return c.json({ error: { code: "BAD_REQUEST", message: "title required" } }, 400);
    }
    const folderId = body.folderId ?? null;
    if (folderId) {
      const f = await deps.db
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.id, folderId))
        .limit(1);
      if (!f[0]) {
        return c.json({ error: { code: "BAD_REQUEST", message: "unknown folderId" } }, 400);
      }
    }
    const doc = await createDoc(deps, {
      folderId,
      title: body.title,
      content: body.content ?? "",
      createdBy: email,
    });
    return c.json(doc, 201);
  });

  // POST /api/documents/import ≈ importDocuments。body {folderId?, files:[{name,content}]}
  app.post("/import", async (c) => {
    const email = c.get("email");
    const body = await c.req
      .json<{ folderId?: string; files?: { name?: string; content?: string }[] }>()
      .catch(() => ({}) as { folderId?: string; files?: { name?: string; content?: string }[] });
    if (!Array.isArray(body.files)) {
      return c.json({ error: { code: "BAD_REQUEST", message: "files[] required" } }, 400);
    }
    if (body.files.length > MAX_IMPORT_FILES) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: `too many files (max ${MAX_IMPORT_FILES})` } },
        400,
      );
    }
    const folderId = body.folderId ?? null;
    const results: { name: string; ok: boolean; id?: string; docName?: string; error?: string }[] =
      [];
    for (const f of body.files) {
      const name = f?.name ?? "(no name)";
      if (typeof f?.content !== "string" || !f?.name) {
        results.push({ name, ok: false, error: "name and content required" });
        continue;
      }
      try {
        const title = titleFromFilename(f.name);
        const doc = await createDoc(deps, { folderId, title, content: f.content, createdBy: email });
        results.push({ name, ok: true, id: doc.id, docName: doc.title });
      } catch (e) {
        results.push({ name, ok: false, error: e instanceof Error ? e.message : "failed" });
      }
    }
    return c.json(results);
  });

  // GET /api/documents/:id  ≈ getDocument / getDocumentBundle(?include=threads,revision)
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const email = c.get("email");
    const rows = await deps.db.select().from(documents).where(eq(documents.id, id)).limit(1);
    const doc = rows[0];
    if (!doc) return c.json({ error: { code: "NOT_FOUND", message: "document not found" } }, 404);

    const ref = doc.storageKey ?? doc.driveFileId;
    const content = ref ? await deps.store.get(ref) : "";
    const base = {
      id: doc.id,
      title: doc.title,
      folderId: doc.folderId,
      content,
      version: doc.version,
      statusId: doc.statusId,
      archived: doc.archived,
      assignee: doc.assignee,
      updatedAt: doc.updatedAt,
    };

    const include = new Set((c.req.query("include") ?? "").split(",").filter(Boolean));
    const extra: Record<string, unknown> = {};

    if (include.has("threads")) {
      const threadRows = await deps.db
        .select()
        .from(threads)
        .where(eq(threads.documentId, id))
        .orderBy(threads.createdAt);
      const ids = threadRows.map((t) => t.id);
      const commentRows = ids.length
        ? await deps.db
            .select()
            .from(comments)
            .where(and(inArray(comments.threadId, ids), eq(comments.deleted, false)))
            .orderBy(comments.createdAt)
        : [];
      extra.threads = threadRows.map((t) => ({
        ...t,
        comments: commentRows.filter((cm) => cm.threadId === t.id),
      }));
    }

    if (include.has("revision")) {
      const rev = await deps.db
        .select()
        .from(revisions)
        .where(and(eq(revisions.documentId, id), eq(revisions.createdBy, email)))
        .limit(1);
      extra.pendingRevision = rev[0] ?? null;
    }

    return c.json({ ...base, ...extra });
  });

  // PUT /api/documents/:id ≈ updateDocument（If-Match: version → 条件付き更新 / 409・§6.3）
  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const email = c.get("email");
    const body = await c.req.json<{ content?: string }>().catch(() => ({}) as { content?: string });
    if (typeof body.content !== "string") {
      return c.json({ error: { code: "BAD_REQUEST", message: "content required" } }, 400);
    }

    const rows = await deps.db.select().from(documents).where(eq(documents.id, id)).limit(1);
    const doc = rows[0];
    if (!doc) return c.json({ error: { code: "NOT_FOUND", message: "document not found" } }, 404);

    const ifMatch = c.req.header("If-Match");
    const expected = ifMatch ? Number(ifMatch.replace(/"/g, "")) : doc.version;
    const next = doc.version + 1;

    // 先に新 version の本体を書く（失敗時の孤児は無害・§6.3）。
    const newKey = await deps.store.put(doc.id, next, body.content);

    // 条件付き更新: WHERE version = expected。0 行なら CONFLICT。
    const updated = await deps.db
      .update(documents)
      .set({
        version: next,
        body: body.content, // 検索用本文コピーを同期
        storageKey: deps.store.backend === "s3" ? newKey : doc.storageKey,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, id), eq(documents.version, expected)))
      .returning({ version: documents.version });

    if (updated.length === 0) {
      return c.json(
        { error: { code: "CONFLICT", message: "version mismatch" }, current: doc.version },
        409,
      );
    }

    // 版履歴（Drive 安全網の代替・§6.4）
    await deps.db.insert(documentVersions).values({
      documentId: doc.id,
      version: next,
      storageKey: newKey,
      createdBy: email,
    });

    return c.json({ id: doc.id, version: next });
  });

  // PATCH /api/documents/:id ≈ setDocumentStatus/Archived/Assignee を1本に統合
  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req
      .json<{ statusId?: string | null; archived?: boolean; assignee?: string | null; title?: string }>()
      .catch(() => ({}) as Record<string, unknown>);

    const rows = await deps.db.select().from(documents).where(eq(documents.id, id)).limit(1);
    const doc = rows[0];
    if (!doc) return c.json({ error: { code: "NOT_FOUND", message: "document not found" } }, 404);

    const patch: Partial<typeof documents.$inferInsert> = {};
    if ("statusId" in body) {
      if (body.statusId === null) {
        patch.statusId = null;
      } else if (typeof body.statusId === "string") {
        const s = await deps.db
          .select({ id: statuses.id })
          .from(statuses)
          .where(eq(statuses.id, body.statusId))
          .limit(1);
        if (!s[0]) {
          return c.json({ error: { code: "BAD_REQUEST", message: "unknown statusId" } }, 400);
        }
        patch.statusId = body.statusId;
      }
    }
    if ("archived" in body && typeof body.archived === "boolean") patch.archived = body.archived;
    if ("assignee" in body) {
      if (body.assignee === null || typeof body.assignee === "string") patch.assignee = body.assignee;
    }
    if ("title" in body && typeof body.title === "string" && body.title.length > 0) {
      patch.title = body.title;
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: { code: "BAD_REQUEST", message: "nothing to update" } }, 400);
    }
    patch.updatedAt = new Date();

    const updated = await deps.db
      .update(documents)
      .set(patch)
      .where(eq(documents.id, id))
      .returning();
    return c.json(updated[0]);
  });

  // DELETE /api/documents/:id ≈ deleteDocument。子レコード→本体ストアもまとめて掃除。
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const rows = await deps.db.select().from(documents).where(eq(documents.id, id)).limit(1);
    const doc = rows[0];
    if (!doc) return c.json({ error: { code: "NOT_FOUND", message: "document not found" } }, 404);

    // 削除前にストアから消すべき ref を集める（版履歴の各版＋現行）。
    const vers = await deps.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, id));
    const refs = new Set<string>();
    for (const v of vers) {
      const r = v.storageKey ?? v.driveFileId;
      if (r) refs.add(r);
    }
    const cur = doc.storageKey ?? doc.driveFileId;
    if (cur) refs.add(cur);

    // FK 順に子→親で削除（threads→comments を含む）。
    await deps.db.transaction(async (tx) => {
      const threadRows = await tx
        .select({ id: threads.id })
        .from(threads)
        .where(eq(threads.documentId, id));
      const tids = threadRows.map((t) => t.id);
      if (tids.length) await tx.delete(comments).where(inArray(comments.threadId, tids));
      await tx.delete(threads).where(eq(threads.documentId, id));
      await tx.delete(revisions).where(eq(revisions.documentId, id));
      await tx.delete(documentVersions).where(eq(documentVersions.documentId, id));
      await tx.delete(documents).where(eq(documents.id, id));
    });

    // 本体ストアは best-effort（DB が正なので失敗しても致命的でない）。
    for (const r of refs) {
      try {
        await deps.store.remove(r);
      } catch {
        /* ignore */
      }
    }
    return c.json({ ok: true });
  });

  return app;
}
