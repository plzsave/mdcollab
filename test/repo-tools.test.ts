import { describe, it, expect } from "vitest";
import { makeHarness, seedMember, textTurn, toolTurn, type Harness } from "./helpers/harness";
import {
  grepFiles,
  isTextPath,
  renderTree,
  searchTerms,
  selectSearchCandidates,
  sliceLines,
} from "../src/github/codeSearch";
import { buildSystem } from "../src/routes/reviews";
import * as schema from "../src/db/schema";

// #82: repo 参照ツールの強化（kb-bot 逆輸入）。
// search_repo_code / fetch_repo_file の行範囲 / list_repo_tree のモノレポ概要化＋subdir。

describe("codeSearch 純関数", () => {
  it("renderTree: 小規模は全ファイル列挙・subdir でその配下に絞る", () => {
    const paths = ["src/a.ts", "src/b.ts", "packages/foo/x.ts", "README.md"];
    expect(renderTree(paths)).toBe(paths.join("\n"));
    expect(renderTree(paths, "packages/foo")).toBe("packages/foo/x.ts");
    expect(renderTree(paths, "nope")).toContain("配下にファイルが見つかりません");
  });

  it("renderTree: 大規模（モノレポ）はトップ階層＋manifest の概要になり subdir 深掘りを促す", () => {
    const paths = [
      ...Array.from({ length: 400 }, (_, i) => `packages/foo/src/f${i}.ts`),
      ...Array.from({ length: 300 }, (_, i) => `packages/bar/src/b${i}.ts`),
      "packages/foo/package.json",
      "packages/bar/package.json",
      "package.json",
    ];
    const out = renderTree(paths);
    expect(out).toContain("概要を表示");
    expect(out).toContain("packages/");
    expect(out).toContain("packages/foo/package.json");
    expect(out).not.toContain("f399.ts"); // 全列挙はしない
    // subdir 指定で深掘りできる
    expect(renderTree(paths, "packages/bar")).toContain("packages/bar/src/b0.ts");
  });

  it("sliceLines: 行範囲を行番号付きで返し、範囲はファイル長・上限でクランプされる", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
    const out = sliceLines("src/a.ts", text, 3, 5);
    expect(out).toContain("# src/a.ts (L3-L5 / 全10行)");
    expect(out).toContain("3| line3");
    expect(out).toContain("5| line5");
    expect(out).not.toContain("line6");
    // end 未指定は上限まで・ファイル末尾でクランプ
    expect(sliceLines("a", text, 8)).toContain("(L8-L10 / 全10行)");
    // start 未指定は全文（行番号付き）
    expect(sliceLines("a", "x\ny")).toContain("1| x");
  });

  it("searchTerms / isTextPath: 語分割と grep 対象判定", () => {
    expect(searchTerms("  Foo   BAR foo ")).toEqual(["foo", "bar"]);
    expect(isTextPath("src/a.ts")).toBe(true);
    expect(isTextPath("docs/x.md")).toBe(true);
    expect(isTextPath("bun.lock")).toBe(false);
    expect(isTextPath("dist/app.min.js")).toBe(false);
    expect(isTextPath("logo.png")).toBe(false);
  });

  it("selectSearchCandidates: パス名に検索語を含むものを優先し cap で切る", () => {
    const paths = ["src/zzz.ts", "src/cache.ts", "src/auth.ts", "img.png"];
    const out = selectSearchCandidates(paths, ["cache"], 2);
    expect(out[0]).toBe("src/cache.ts"); // パス名一致が先頭
    expect(out).toHaveLength(2);
    expect(out).not.toContain("img.png"); // 非テキストは除外
  });

  it("grepFiles: 同一行 AND を優先し、全滅なら OR に緩めて broadened を立てる", () => {
    const files = [
      { path: "a.ts", content: "const cache = new Map()\nfoo bar\ncache TTL here" },
      { path: "b.ts", content: "nothing" },
    ];
    const strict = grepFiles(files, ["cache", "ttl"]);
    expect(strict.broadened).toBe(false);
    expect(strict.matches).toEqual([{ path: "a.ts", line: 3, text: "cache TTL here" }]);

    const broadened = grepFiles(files, ["cache", "zzz"]);
    expect(broadened.broadened).toBe(true);
    expect(broadened.matches.map((m) => m.line)).toEqual([1, 3]);

    expect(grepFiles(files, []).matches).toEqual([]);
  });

  it("grepFiles: maxPerFile / maxTotal で散らし・打ち切りする", () => {
    const files = [
      { path: "a.ts", content: "hit\nhit\nhit\nhit\nhit" },
      { path: "b.ts", content: "hit" },
    ];
    const r = grepFiles(files, ["hit"], { maxPerFile: 2, maxTotal: 3 });
    expect(r.matches.map((m) => `${m.path}:${m.line}`)).toEqual(["a.ts:1", "a.ts:2", "b.ts:1"]);
  });
});

describe("buildSystem の repo 指針（#82）", () => {
  it("repo ツールありのときだけ「実コードを確認」の導線が入る", () => {
    expect(buildSystem(true, true)).toContain("実コードを確認");
    expect(buildSystem(true, true)).toContain("search_repo_code");
    expect(buildSystem(true, false)).not.toContain("search_repo_code");
    expect(buildSystem(false)).not.toContain("ツール");
  });
});

// メンバー + AI 設定 + repo/PAT + 文書（review-repo を repo ツール付きで動かせる状態）。
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

async function postReviewRepo(h: Harness) {
  return h.req("/api/documents/d1/review-repo", {
    as: "u@example.com",
    method: "POST",
    body: JSON.stringify({}),
  });
}

describe("review-repo の repo ツール強化（#82）", () => {
  it("search_repo_code が repo ツールに加わり、query/path が GithubClient に渡る", async () => {
    const h = await setupRepo();
    h.llm.script.push(
      toolTurn({ name: "search_repo_code", input: { query: "cache TTL", path: "packages/foo" } }),
      textTurn("確認済み"),
    );
    const res = await postReviewRepo(h);
    expect(res.status).toBe(200);
    expect(h.github.searchCalls).toEqual([
      { repo: "owner/repo", query: "cache TTL", pat: "ghp_secret", path: "packages/foo" },
    ]);
    // 検索結果が次ターンの会話に tool_result として積まれている
    const lastMessages = JSON.stringify(h.llm.converseCalls.at(-1)!.messages);
    expect(lastMessages).toContain("FAKE-SEARCH(owner/repo:cache TTL:packages/foo)");
    // ツール一覧にも载る + system に「実コードを確認」導線
    const toolNames = h.llm.converseCalls.at(-1)!.tools.map((t) => t.name);
    expect(toolNames).toContain("search_repo_code");
    expect(h.llm.converseCalls.at(-1)!.system).toContain("実コードを確認");
  });

  it("fetch_repo_file の start_line / end_line が GithubClient に渡る", async () => {
    const h = await setupRepo();
    h.llm.script.push(
      toolTurn({ name: "fetch_repo_file", input: { path: "src/x.ts", start_line: 10, end_line: 20 } }),
      textTurn("OK"),
    );
    const res = await postReviewRepo(h);
    expect(res.status).toBe(200);
    expect(h.github.fileCalls).toEqual([
      { repo: "owner/repo", path: "src/x.ts", pat: "ghp_secret", startLine: 10, endLine: 20 },
    ]);
  });

  it("list_repo_tree の subdir が GithubClient に渡る", async () => {
    const h = await setupRepo();
    h.llm.script.push(
      toolTurn({ name: "list_repo_tree", input: { subdir: "packages/foo" } }),
      textTurn("OK"),
    );
    const res = await postReviewRepo(h);
    expect(res.status).toBe(200);
    expect(h.github.treeCalls).toEqual([{ repo: "owner/repo", pat: "ghp_secret", subdir: "packages/foo" }]);
  });

  it("不正入力（query 空・行番号が数値でない）はメモ文字列で弾き throw しない", async () => {
    const h = await setupRepo();
    h.llm.script.push(
      toolTurn(
        { name: "search_repo_code", input: {} },
        { name: "fetch_repo_file", input: { path: "a.ts", start_line: "ten" } },
      ),
      textTurn("OK"),
    );
    const res = await postReviewRepo(h);
    expect(res.status).toBe(200);
    expect(h.github.searchCalls).toHaveLength(0);
    expect(h.github.fileCalls).toHaveLength(0);
    const lastMessages = JSON.stringify(h.llm.converseCalls.at(-1)!.messages);
    expect(lastMessages).toContain("不正な入力");
  });
});
