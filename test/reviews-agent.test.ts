import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeHarness, seedMember, textTurn, toolTurn, type Harness } from "./helpers/harness";
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

  it("PAT 未設定の review-repo はツールなしで単発に縮退する", async () => {
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
    // PAT 無し → tools 空 → converse 1 周（デフォルト応答）で完了
    const res = await h.req("/api/documents/d1/review-repo", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(h.llm.converseCalls.at(-1)!.tools).toHaveLength(0);
    expect(h.github.fileCalls).toHaveLength(0);
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
