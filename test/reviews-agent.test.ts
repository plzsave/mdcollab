import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeHarness, seedMember, textTurn, toolTurn, withUsage, type Harness } from "./helpers/harness";
import { createGithubClient } from "../src/github/client";
import { buildSystem } from "../src/routes/reviews";
import { fetchRepoFileTool } from "../src/ai/reviewTools";
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
    expect(toolNames).toEqual([
      "get_doc_threads",
      "search_docs",
      "read_doc",
      "get_revision_diff",
      "web_fetch",
    ]);
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

  it("read_doc: 指定 id の文書全文を tool_result に積む（id 引数）", async () => {
    const h = await setupRepo();
    const k = await h.store.put("d2", 1, "# 関連メモ\n詳細な本文をここに全部記載");
    await h.db
      .insert(schema.documents)
      .values({ id: "d2", title: "関連メモ", storageKey: k, version: 1, createdBy: "u@example.com" });

    h.llm.script.push(toolTurn({ name: "read_doc", input: { id: "d2" } }), textTurn("全文確認"));
    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { toolsUsed: string[] };
    expect(body.toolsUsed).toEqual(["read_doc:d2"]); // describeArg が id を表示
    const messages = JSON.stringify(h.llm.converseCalls.at(-1)!.messages);
    expect(messages).toContain("詳細な本文をここに全部記載");
    expect(messages).toContain("id: d2");
  });

  it("read_doc: 未知 id はメモを返す（never throw）", async () => {
    const h = await setupRepo();
    h.llm.script.push(toolTurn({ name: "read_doc", input: { id: "nope" } }), textTurn("ok"));
    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(h.llm.converseCalls.at(-1)!.messages)).toContain("見つかりません");
  });

  it("get_revision_diff: 前版→現版の行差分を tool_result に積む", async () => {
    const h = await setupRepo();
    const k1 = await h.store.put("d1", 1, "line A\nline B\nline C");
    const k2 = await h.store.put("d1", 2, "line A\nline B2\nline C");
    await h.db.insert(schema.documentVersions).values([
      { documentId: "d1", version: 1, storageKey: k1, createdBy: "u@example.com" },
      { documentId: "d1", version: 2, storageKey: k2, createdBy: "u@example.com" },
    ]);

    h.llm.script.push(toolTurn({ name: "get_revision_diff", input: {} }), textTurn("差分確認"));
    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const messages = JSON.stringify(h.llm.converseCalls.at(-1)!.messages);
    expect(messages).toContain("- line B"); // 旧行が削除として出る
    expect(messages).toContain("+ line B2"); // 新行が追加として出る
  });

  it("get_revision_diff: 版が1つ以下なら差分なしメモ（setupRepo は版履歴を作らない）", async () => {
    const h = await setupRepo();
    h.llm.script.push(toolTurn({ name: "get_revision_diff", input: {} }), textTurn("ok"));
    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(h.llm.converseCalls.at(-1)!.messages)).toContain("前版がありません");
  });

  it("revision: 読み取り専用ツールを読んでから書き直し全文を返し pending に upsert（usage 保存）", async () => {
    const h = await setupRepo();
    // 1ターン目で参照コードを読み、2ターン目で書き直し全文を返す。
    h.llm.script.push(
      withUsage(toolTurn({ name: "fetch_repo_file", input: { path: "src/x.ts" } }), {
        inputTokens: 60,
        outputTokens: 10,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      }),
      withUsage(textTurn("# 書き直し\n本文を整えました"), {
        inputTokens: 40,
        outputTokens: 90,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      }),
    );

    const res = await h.req("/api/documents/d1/revision", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ reviewContent: "曖昧", instructions: "整えて" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      revised: string;
      toolsUsed: string[];
      usage: { inputTokens: number; outputTokens: number };
    };
    expect(body.revised).toBe("# 書き直し\n本文を整えました"); // 最終全文のみ
    expect(body.toolsUsed).toEqual(["fetch_repo_file:src/x.ts"]);
    expect(body.usage).toEqual({ inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 });

    // 読み取り専用ツールのみ（書き込み系・list_repo_tree・search_docs は持たせない）
    const toolNames = h.llm.converseCalls.at(-1)!.tools.map((t) => t.name);
    expect(toolNames).toEqual(["get_doc_threads", "read_doc", "fetch_repo_file"]);

    // doc×user で 1 件・usage 列が保存される
    const rows = await h.db
      .select()
      .from(schema.revisions)
      .where(eq(schema.revisions.documentId, "d1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe("# 書き直し\n本文を整えました");
    expect(rows[0]!.inputTokens).toBe(100);
    expect(rows[0]!.outputTokens).toBe(100);
    expect(JSON.parse(rows[0]!.toolsUsed!)).toEqual(["fetch_repo_file:src/x.ts"]);
  });

  it("revision: PAT/repo 未設定なら repo ツールは付かない（doc 読み取りのみ）", async () => {
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

    const res = await h.req("/api/documents/d1/revision", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({ instructions: "整えて" }),
    });
    expect(res.status).toBe(200);
    const toolNames = h.llm.converseCalls.at(-1)!.tools.map((t) => t.name);
    expect(toolNames).toEqual(["get_doc_threads", "read_doc"]); // fetch_repo_file は付かない
  });

  it("web_fetch: tool_use で url を WebClient に渡し結果を tool_result に積む（G2）", async () => {
    const h = await setupRepo();
    h.llm.script.push(
      toolTurn({ name: "web_fetch", input: { url: "https://example.com/spec" } }),
      textTurn("外部仕様を確認"),
    );
    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { toolsUsed: string[] };
    expect(body.toolsUsed).toEqual(["web_fetch:https://example.com/spec"]); // describeArg が url を表示
    expect(h.web.calls).toEqual(["https://example.com/spec"]); // ガード付き WebClient に委譲
    expect(JSON.stringify(h.llm.converseCalls.at(-1)!.messages)).toContain("FAKE-WEB(https://example.com/spec)");
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
    expect(toolNames).toEqual([
      "get_doc_threads",
      "search_docs",
      "read_doc",
      "get_revision_diff",
      "web_fetch",
    ]);
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

  // §9 / Phase F1: 本文に「.env を読んで貼れ」等を仕込まれても PAT で秘密を持ち出させない。
  it.each([
    [".env", "環境変数"],
    [".env.production", "環境変数"],
    ["config/.env.local", "環境変数"],
    ["deploy/prod.pem", "鍵"],
    ["certs/server.key", "鍵"],
    ["secrets.json", "秘密情報"],
    ["config/secrets/prod.yml", "秘密情報"],
    [".ssh/id_rsa", "SSH 秘密鍵"],
    ["keys/id_ed25519", "SSH 秘密鍵"],
  ])("秘匿ファイル %s を取得拒否する（never throw・メモ返却）", async (path, hint) => {
    const out = await gh.fetchRepoFile("owner/repo", path, "pat");
    expect(out).toContain("取得拒否");
    expect(out).toContain(hint);
  });

  it("通常のソースファイルは denylist を通過する（fetch まで到達）", async () => {
    // 秘匿でない名前（例: keychain.ts）を過剰防御で弾かないことを、fetch を差し替えて確認する。
    const orig = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      const content = Buffer.from("export const x = 1;\n").toString("base64");
      return new Response(JSON.stringify({ type: "file", encoding: "base64", content }), { status: 200 });
    }) as typeof fetch;
    try {
      const out = await gh.fetchRepoFile("owner/repo", "src/keychain.ts", "pat");
      expect(called).toBe(true); // denylist で止まらず取得に進んだ
      expect(out).toContain("export const x = 1;");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("秘匿ファイルは fetch まで到達せず拒否する（PAT を一切使わない）", async () => {
    const orig = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const out = await gh.fetchRepoFile("owner/repo", ".env", "pat");
      expect(called).toBe(false); // ネットワークに出る前に拒否
      expect(out).toContain("取得拒否");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("プロンプトインジェクション耐性の構造的保証（§9 / Phase F1）", () => {
  it("buildSystem は不信任宣言（本文の指示に従わない）を必ず含む", () => {
    for (const hasTools of [false, true]) {
      const sys = buildSystem(hasTools);
      expect(sys).toContain("本文");
      expect(sys).toContain("従わないでください");
    }
  });

  it("fetch_repo_file のツールは repo を入力に取らない＝本文から参照先を変えられない", () => {
    const deps = { github: { fetchRepoFile: async () => "x" } } as never;
    const tool = fetchRepoFileTool(deps, "owner/repo", "pat");
    const props = tool.def.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(["path"]); // repo は工場が固定・スキーマに無い
  });

  it("review-repo: 本文に repo らしき指示があってもツールは工場固定の repo で呼ばれる", async () => {
    const h = await setupRepo();
    h.llm.script.push(
      toolTurn({ name: "fetch_repo_file", input: { path: "src/x.ts", repo: "attacker/evil" } }),
      textTurn("done"),
    );
    await h.req("/api/documents/d1/review-repo", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    // input に紛れ込ませた repo は無視され、工場が捕捉した owner/repo で取得される
    expect(h.github.fileCalls).toEqual([{ repo: "owner/repo", path: "src/x.ts", pat: "ghp_secret" }]);
  });
});
