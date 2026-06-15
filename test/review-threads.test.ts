import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeHarness, seedMember, textTurn, type Harness } from "./helpers/harness";
import * as schema from "../src/db/schema";

// ① 指摘のコメントスレッド化（review-threads）。LLM は finding(JSON) を返すだけ＝fake で決定的に検証。

async function setup(content: string): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  const key = await h.store.put("d1", 1, content);
  await h.db
    .insert(schema.documents)
    .values({ id: "d1", title: "Doc", storageKey: key, version: 1, createdBy: "u@example.com" });
  await h.req("/api/ai/settings", {
    as: "u@example.com",
    method: "PUT",
    body: JSON.stringify({ provider: "anthropic", model: "claude-x", apiKey: "sk" }),
  });
  return h;
}

const post = (h: Harness, body: object = {}) =>
  h.req("/api/documents/d1/review-threads", {
    as: "u@example.com",
    method: "POST",
    body: JSON.stringify(body),
  });

describe("AI レビュー指摘のコメントスレッド化 (①)", () => {
  it("finding を ai-review 著者のスレッド+コメントにアンカーして作る", async () => {
    const h = await setup("# 文書\n\nIssue 作成にレート制限は設けない。GitHub 側に任せる。\n");
    h.llm.script.push(
      textTurn(
        JSON.stringify([
          { quote: "Issue 作成にレート制限は設けない", comment: "濫用に弱い。制限を設けるべき。", severity: "warn" },
        ]),
      ),
    );

    const res = await post(h);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 1, total: 1 });

    const thr = await h.db.select().from(schema.threads).where(eq(schema.threads.documentId, "d1"));
    expect(thr).toHaveLength(1);
    expect(thr[0]!.createdBy).toBe("ai-review");
    expect(thr[0]!.status).toBe("open");
    expect(thr[0]!.anchorText).toBe("Issue 作成にレート制限は設けない"); // 光る＝正規化 quote

    const cms = await h.db.select().from(schema.comments).where(eq(schema.comments.threadId, thr[0]!.id));
    expect(cms).toHaveLength(1);
    expect(cms[0]!.author).toBe("ai-review");
    expect(cms[0]!.content).toContain("制限を設けるべき");
  });

  it("degrade: 光らない引用（インラインコードまたぎ）でもスレッドは作る", async () => {
    const h = await setup("PAT は `ai_keys` テーブルに平文で保存する。");
    h.llm.script.push(
      textTurn(JSON.stringify([{ quote: "`ai_keys` テーブルに平文で保存", comment: "暗号化すべき" }])),
    );

    const res = await post(h);
    expect((await res.json()).created).toBe(1);
    const thr = await h.db.select().from(schema.threads).where(eq(schema.threads.documentId, "d1"));
    expect(thr).toHaveLength(1);
    // 光らないので raw quote をそのまま anchorText に（パネルには出る）
    expect(thr[0]!.anchorText).toBe("`ai_keys` テーブルに平文で保存");
  });

  it("再実行は ai-review の open スレを置換し、resolved と人間スレは残す", async () => {
    const h = await setup("新機能を追加する予定。");
    await h.db.insert(schema.threads).values([
      { id: "ai-open", documentId: "d1", anchorText: "古いAI指摘", status: "open", createdBy: "ai-review" },
      { id: "ai-res", documentId: "d1", anchorText: "解決済みAI", status: "resolved", createdBy: "ai-review" },
      { id: "human", documentId: "d1", anchorText: "人間の指摘", status: "open", createdBy: "u@example.com" },
    ]);
    await h.db.insert(schema.comments).values([
      { id: "c-open", threadId: "ai-open", content: "古い", author: "ai-review" },
      { id: "c-res", threadId: "ai-res", content: "済", author: "ai-review" },
      { id: "c-hum", threadId: "human", content: "人間", author: "u@example.com" },
    ]);

    h.llm.script.push(textTurn(JSON.stringify([{ quote: "新機能を追加する", comment: "目的が不明確" }])));
    const res = await post(h);
    expect((await res.json()).created).toBe(1);

    const thr = await h.db.select().from(schema.threads).where(eq(schema.threads.documentId, "d1"));
    const ids = thr.map((t) => t.id);
    expect(ids).not.toContain("ai-open"); // 置換で消える
    expect(ids).toContain("ai-res"); // resolved は残す
    expect(ids).toContain("human"); // 人間スレは残す
    // 古い AI コメントも消える / 人間・resolved は残る
    const cms = await h.db.select().from(schema.comments);
    const cIds = cms.map((c) => c.id);
    expect(cIds).not.toContain("c-open");
    expect(cIds).toContain("c-res");
    expect(cIds).toContain("c-hum");
    // 新しい ai-review open スレが 1 件だけ
    expect(thr.filter((t) => t.createdBy === "ai-review" && t.status === "open")).toHaveLength(1);
  });

  it("JSON でない出力・指摘0件は created:0 で 200（never throw）", async () => {
    const h = await setup("本文。");
    h.llm.script.push(textTurn("これは JSON ではない普通の講評です。"));
    const res = await post(h);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 0, total: 0 });
    const thr = await h.db.select().from(schema.threads).where(eq(schema.threads.documentId, "d1"));
    expect(thr).toHaveLength(0);
  });

  it("AI 未設定は 400", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    await h.db
      .insert(schema.documents)
      .values({ id: "d1", title: "D", version: 1, createdBy: "u@example.com" });
    const res = await post(h);
    expect(res.status).toBe(400);
  });
});
