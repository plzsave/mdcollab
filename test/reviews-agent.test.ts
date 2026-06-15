import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeHarness, seedMember, textTurn, toolTurn, withUsage, type Harness } from "./helpers/harness";
import { createGithubClient } from "../src/github/client";
import * as schema from "../src/db/schema";

// メンバー + AI 設定 + repo/PAT + 本文付き文書を用意する（review-repo を tools 付きで動かせる状態）。
async function setupRepo(): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  const key = await h.store.put("d1", 1, "# 文書\nsrc/x.ts を参照");
  await h.db
    .insert(schema.documents)
    .values({ id: "d1", title: "Doc", storageKey: key, version: 1, createdBy: "u@example.com" });
  await h.req("/api/ai/settings", {
    as: "u@example.com",
    method: "PUT",
    body: JSON.stringify({ provider: "anthropic", model: "claude-x", apiKey: "sk-test" }),
  });
  await h.req("/api/ai/github/repo", {
    as: "u@example.com",
    method: "PUT",
    body: JSON.stringify({ repo: "owner/repo" }),
  });
  await h.req("/api/ai/github/pat", {
    as: "u@example.com",
    method: "PUT",
    body: JSON.stringify({ scope: "default", pat: "ghp_secret" }),
  });
  return h;
}

describe("AI Review Agent（tool use ループ）", () => {
  it("review-repo: tool_use → fetch_repo_file が正しい引数で呼ばれ、最終レビューを保存", async () => {
    const h = await setupRepo();
    // 1ターン目: src/x.ts を読む。2ターン目: 指摘を返して完了。
    h.llm.script.push(toolTurn({ name: "fetch_repo_file", input: { path: "src/x.ts" } }), textTurn("指摘: 命名が不明瞭"));

    const res = await h.req("/api/documents/d1/review-repo", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ instructions: "見て" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { review: string; toolsUsed: string[]; truncated: boolean };
    expect(body.review).toBe("指摘: 命名が不明瞭");
    expect(body.toolsUsed).toEqual(["fetch_repo_file:src/x.ts"]);
    expect(body.truncated).toBe(false);

    // ツールは固定 repo + 復号済み PAT で正しいパスを受け取る
    expect(h.github.fileCalls).toEqual([{ repo: "owner/repo", path: "src/x.ts", pat: "ghp_secret" }]);

    // 2 ターン目の messages にツール結果（FAKE-FILE）が tool_result として積まれている
    const lastMessages = JSON.stringify(h.llm.converseCalls.at(-1)!.messages);
    expect(lastMessages).toContain("FAKE-FILE(owner/repo:src/x.ts)");

    // 最終本文のみ保存される（中間のツール痕跡は本文に含めない）
    const rows = await h.db.select().from(schema.reviews).where(eq(schema.reviews.documentId, "d1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe("指摘: 命名が不明瞭");
  });

  it("暴走ガード: 1ターン複数ツールでも総数 MAX_TOOL_CALLS(12) で打ち切り truncated:true で保存", async () => {
    const h = await setupRepo();
    // 1 ターン 5 ツール × 全ターン。MAX_TURNS(6) より先に総ツール 12 上限に当たる。
    const five = Array.from({ length: 5 }, (_, i) => ({ name: "fetch_repo_file", input: { path: `a${i}.ts` } }));
    for (let t = 0; t < 6; t++) h.llm.script.push(toolTurn(...five));

    const res = await h.req("/api/documents/d1/review-repo", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { truncated: boolean };
    expect(body.truncated).toBe(true);
    // 総ツール呼び出し上限（12）で止まる＝13 本目を実行する前に打ち切る
    expect(h.github.fileCalls.length).toBe(12);
    // 部分結果でも保存される
    const rows = await h.db.select().from(schema.reviews).where(eq(schema.reviews.documentId, "d1"));
    expect(rows).toHaveLength(1);
  });

  it("暴走ガード: 毎ターン 1 ツールだと MAX_TURNS(6) で打ち切り truncated:true", async () => {
    const h = await setupRepo();
    for (let t = 0; t < 30; t++) {
      h.llm.script.push(toolTurn({ name: "fetch_repo_file", input: { path: `f${t}.ts` } }));
    }
    const res = await h.req("/api/documents/d1/review-repo", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { truncated: boolean };
    expect(body.truncated).toBe(true);
    // 6 ターン分だけツールが実行される（MAX_TOOL_CALLS には達しない）
    expect(h.github.fileCalls.length).toBe(6);
  });

  it("未知ツール: unknown tool を tool_result で返してループ継続→最終的に完了", async () => {
    const h = await setupRepo();
    h.llm.script.push(toolTurn({ name: "no_such_tool", input: {} }), textTurn("完了"));

    const res = await h.req("/api/documents/d1/review-repo", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).review).toBe("完了");
    // 未知ツールなので github は呼ばれない。tool_result に unknown tool メモが入る。
    expect(h.github.fileCalls).toHaveLength(0);
    expect(JSON.stringify(h.llm.converseCalls.at(-1)!.messages)).toContain("unknown tool: no_such_tool");
  });

  it("SSE: converse が throw すると error イベントを流して閉じる", async () => {
    const h = await setupRepo();
    h.llm.converse = async () => {
      throw new Error("boom");
    };
    const res = await h.req("/api/documents/d1/review-repo?stream=1", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("boom");
    // 失敗時はレビューを保存しない
    const rows = await h.db.select().from(schema.reviews).where(eq(schema.reviews.documentId, "d1"));
    expect(rows).toHaveLength(0);
  });

  it("PAT 未設定の review-repo は repo ツールが付かない（doc ツールのみ）", async () => {
    const h = await makeHarness();
    await seedMember(h, "u@example.com", "member");
    const key = await h.store.put("d1", 1, "# 文書\n本文");
    await h.db
      .insert(schema.documents)
      .values({ id: "d1", title: "D", storageKey: key, version: 1, createdBy: "u@example.com" });
    await h.req("/api/ai/settings", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ provider: "anthropic", model: "claude-x", apiKey: "sk" }),
    });
    await h.req("/api/ai/github/repo", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ repo: "owner/repo" }),
    });
    const res = await h.req("/api/documents/d1/review-repo", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    // doc/workspace ツールは付くが、PAT 無しなので repo ツール（fetch_repo_file/list_repo_tree）は付かない
    const toolNames = h.llm.converseCalls.at(-1)!.tools.map((t) => t.name);
    expect(toolNames).toEqual(["get_doc_threads", "search_docs"]);
    expect(h.github.fileCalls).toHaveLength(0);
    expect(h.github.treeCalls).toHaveLength(0);
  });

  it("list_repo_tree: tool_use でツリーを取得し結果が次ターンの会話に積まれる", async () => {
    const h = await setupRepo();
    h.llm.script.push(toolTurn({ name: "list_repo_tree", input: {} }), textTurn("ツリー確認済み"));

    const res = await h.req("/api/documents/d1/review-repo", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { review: string; toolsUsed: string[] };
    expect(body.review).toBe("ツリー確認済み");
    expect(h.github.treeCalls).toEqual([{ repo: "owner/repo", pat: "ghp_secret" }]);
    expect(JSON.stringify(h.llm.converseCalls.at(-1)!.messages)).toContain("src/a.ts");
  });

  it("get_doc_threads: tool_use で当該 doc のスレッド本文を tool_result に積む", async () => {
    const h = await setupRepo();
    await h.db.insert(schema.threads).values({
      id: "t1",
      documentId: "d1",
      anchorText: "ここ",
      status: "open",
      createdBy: "u@example.com",
    });
    await h.db
      .insert(schema.comments)
      .values({ id: "c1", threadId: "t1", content: "曖昧な表現です", author: "reviewer@example.com" });

    h.llm.script.push(toolTurn({ name: "get_doc_threads", input: {} }), textTurn("スレッド反映済み"));

    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const messages = JSON.stringify(h.llm.converseCalls.at(-1)!.messages);
    expect(messages).toContain("曖昧な表現です");
    expect(messages).toContain("[open]");
  });

  it("search_docs: tool_use でタイトル一致の他文書を返す（当該 doc は除外）", async () => {
    const h = await setupRepo();
    await h.db
      .insert(schema.documents)
      .values({ id: "d2", title: "関連メモ", version: 1, createdBy: "u@example.com" });

    h.llm.script.push(toolTurn({ name: "search_docs", input: { query: "関連" } }), textTurn("関連文書を確認"));

    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { toolsUsed: string[] };
    expect(body.toolsUsed).toEqual(["search_docs:関連"]); // describeArg が query を表示
    const messages = JSON.stringify(h.llm.converseCalls.at(-1)!.messages);
    expect(messages).toContain("関連メモ");
    expect(messages).toContain("id: d2");
    expect(messages).not.toContain("id: d1"); // 当該 doc は除外
  });

  it("search_docs: 本文一致でも見つかり、一致箇所のスニペットを返す（本文は丸ごと返さない）", async () => {
    const h = await setupRepo();
    const longBody =
      "前置き".repeat(80) + "重要な仕様はこのキーワードの近くにある" + "後置き".repeat(80);
    await h.db.insert(schema.documents).values({
      id: "d2",
      title: "無関係なタイトル", // タイトルには "キーワード" を含めない＝本文一致のみ
      body: longBody,
      version: 1,
      createdBy: "u@example.com",
    });

    h.llm.script.push(toolTurn({ name: "search_docs", input: { query: "キーワード" } }), textTurn("確認"));

    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const toolResult = JSON.stringify(h.llm.converseCalls.at(-1)!.messages);
    expect(toolResult).toContain("無関係なタイトル"); // 本文一致でヒット
    expect(toolResult).toContain("id: d2");
    expect(toolResult).toContain("重要な仕様はこのキーワードの近くにある"); // スニペットに一致周辺
    expect(toolResult).toContain("…"); // 前後が切り詰められている
    expect(toolResult).not.toContain("前置き".repeat(80)); // 本文を丸ごとは返さない
  });

  it("コスト計測: 全ターンの usage を合算し応答・reviews 行に保存（Phase E）", async () => {
    const h = await setupRepo();
    // 1 ターン目（ツール）と 2 ターン目（完了）でそれぞれ usage を返す。
    h.llm.script.push(
      withUsage(toolTurn({ name: "fetch_repo_file", input: { path: "src/x.ts" } }), {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 80,
        cacheCreationInputTokens: 10,
      }),
      withUsage(textTurn("指摘"), {
        inputTokens: 50,
        outputTokens: 30,
        cacheReadInputTokens: 40,
        cacheCreationInputTokens: 0,
      }),
    );

    const res = await h.req("/api/documents/d1/review-repo", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
    };
    // 2 ターン合算（列名にマップ）
    expect(body.usage).toEqual({ inputTokens: 150, outputTokens: 50, cacheReadTokens: 120, cacheWriteTokens: 10 });

    const [row] = await h.db.select().from(schema.reviews).where(eq(schema.reviews.documentId, "d1"));
    expect(row!.inputTokens).toBe(150);
    expect(row!.outputTokens).toBe(50);
    expect(row!.cacheReadTokens).toBe(120);
    expect(row!.cacheWriteTokens).toBe(10);
    expect(JSON.parse(row!.toolsUsed!)).toEqual(["fetch_repo_file:src/x.ts"]);
    expect(row!.truncated).toBe(false);
  });

  it("コスト計測: usage を返さないプロバイダは usage 省略・列は null", async () => {
    const h = await setupRepo();
    h.llm.script.push(textTurn("指摘だけ")); // usage 無し

    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).usage).toBeUndefined();

    const [row] = await h.db.select().from(schema.reviews).where(eq(schema.reviews.documentId, "d1"));
    expect(row!.inputTokens).toBeNull();
    expect(row!.cacheReadTokens).toBeNull();
    // usage が無くても toolsUsed/truncated は保存される
    expect(row!.truncated).toBe(false);
    expect(JSON.parse(row!.toolsUsed!)).toEqual([]);
  });

  it("plain review もツール（doc/workspace）を持つ", async () => {
    const h = await setupRepo();
    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const toolNames = h.llm.converseCalls.at(-1)!.tools.map((t) => t.name);
    expect(toolNames).toEqual(["get_doc_threads", "search_docs"]);
  });
});

describe("fetchRepoFile のパス検証（実 github クライアント・ネットワーク不要）", () => {
  const gh = createGithubClient();

  it("親ディレクトリ参照（..）を弾く", async () => {
    const out = await gh.fetchRepoFile("owner/repo", "../../etc/passwd", "pat");
    expect(out).toContain("取得拒否");
    expect(out).toContain("..");
  });

  it("絶対パスを弾く", async () => {
    expect(await gh.fetchRepoFile("owner/repo", "/etc/passwd", "pat")).toContain("絶対パス");
  });

  it("URL を弾く", async () => {
    expect(await gh.fetchRepoFile("owner/repo", "https://evil.example/x", "pat")).toContain("URL");
  });

  it("空パスを弾く", async () => {
    expect(await gh.fetchRepoFile("owner/repo", "  ", "pat")).toContain("空");
  });
});
