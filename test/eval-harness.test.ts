import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateVerdict,
  buildScorecard,
  caseSetFingerprint,
  citationFails,
  evalCase,
  evaluatedScoredNames,
  exitPassed,
  overallPassed,
  parseBaseline,
  statusLabel,
  validateCases,
  type Case,
  type CaseResult,
  type RawCase,
} from "../scripts/eval/harness";
import { makeFixtureGithub } from "../scripts/eval/fakes";
import { runCase } from "../scripts/eval/run";
import { makeFakeLlm, textTurn, toolTurn } from "./helpers/harness";

// #83: eval ハーネスの基盤（採点・スコアカード・集約ゲート・fixture・実行経路）は
// ネットワークなしで検証する。ライブ eval（実 LLM）は scripts/eval-review.ts の手動実行のみ。

describe("validateCases", () => {
  it("正しいケースは通り、不正な軸/フラグ/形は実行前にエラーになる", () => {
    expect(validateCases([{ name: "a", doc: "x", expect: {} }])).toEqual([]);
    const errors = validateCases([
      { name: "", doc: "x", expect: {} },
      { name: "b", doc: "", expect: {} },
      { name: "c", doc: "x" }, // expect なし
      { name: "d", doc: "x", expect: {}, axis: "Z" },
      { name: "e", doc: "x", expect: {}, gate: "yes" },
      { name: "f", doc: "x", expect: {}, monitor: 1 },
      { name: "g", doc: "x", expect: {}, gate: true, monitor: true },
      { name: "h", doc: "x", expect: {}, repo: { files: { "a.ts": 1 } } },
      { name: "h", doc: "x", expect: {} }, // name 重複
    ] as RawCase[]);
    expect(errors).toHaveLength(9);
    expect(errors.join("\n")).toContain("不正な評価軸");
    expect(errors.join("\n")).toContain("同時に指定できない");
    expect(errors.join("\n")).toContain("重複");
  });

  it("同梱の cases.json は常に valid（出荷ゲート）", () => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "..", "scripts", "eval", "cases.json"), "utf8"),
    ) as RawCase[];
    expect(raw.length).toBeGreaterThanOrEqual(10);
    expect(validateCases(raw)).toEqual([]);
    // gate ケースを最低 1 件含む（--gate-only の短縮ランが成立する）
    expect(raw.some((c) => c.gate === true)).toBe(true);
  });
});

describe("evalCase（本文＋ツールトレースの採点）", () => {
  const calls = [
    { name: "search_repo_code", input: { query: "fee", path: "packages/billing" }, output: "..." },
    { name: "fetch_repo_file", input: { path: "src/config.ts", start_line: 1 }, output: "..." },
  ];

  it("toolsUsedAny / toolsUsedAll / argIncludes / readPathIncludes を検査する", () => {
    expect(evalCase({ toolsUsedAny: ["fetch_repo_file", "list_repo_tree"] }, calls, "")).toEqual([]);
    expect(evalCase({ toolsUsedAny: ["web_fetch"] }, calls, "")).toHaveLength(1);
    expect(evalCase({ toolsUsedAll: ["search_repo_code", "fetch_repo_file"] }, calls, "")).toEqual([]);
    expect(evalCase({ toolsUsedAll: ["get_doc_threads"] }, calls, "")).toHaveLength(1);
    expect(evalCase({ argIncludes: "packages/billing" }, calls, "")).toEqual([]);
    expect(evalCase({ argIncludes: "packages/web" }, calls, "")).toHaveLength(1);
    expect(evalCase({ readPathIncludes: "config.ts" }, calls, "")).toEqual([]);
    expect(evalCase({ readPathIncludes: "other.ts" }, calls, "")).toHaveLength(1);
  });

  it("reviewIncludes は全語必須・reviewOmits は禁止語（大小無視）", () => {
    expect(evalCase({ reviewIncludes: ["60", "タイムアウト"] }, [], "タイムアウトは 60 秒")).toEqual([]);
    expect(evalCase({ reviewIncludes: ["60", "無い語"] }, [], "60 秒")).toHaveLength(1);
    expect(evalCase({ reviewOmits: ["CANARY"] }, [], "本文に canary が漏れた")).toHaveLength(1);
    expect(evalCase({ reviewOmits: ["CANARY"] }, [], "安全なレビュー")).toEqual([]);
  });

  it("citesPathLine: 汎用は path:line 体裁・readPathIncludes 併用時は読んだ path を厳格検査", () => {
    expect(citationFails({ citesPathLine: true }, "根拠は src/config.ts:3 を参照")).toEqual([]);
    expect(citationFails({ citesPathLine: true }, "根拠はコードのどこか")).toHaveLength(1);
    expect(
      citationFails({ citesPathLine: true, readPathIncludes: "config.ts" }, "src/config.ts:3 に定義"),
    ).toEqual([]);
    expect(
      citationFails({ citesPathLine: true, readPathIncludes: "config.ts" }, "src/other.ts:9 に定義"),
    ).toHaveLength(1);
    expect(citationFails({}, "何もなし")).toEqual([]); // 未指定は検査しない
  });
});

describe("スコアカード・集約ゲート", () => {
  const r = (over: Partial<CaseResult> & { name: string }): CaseResult => ({
    gate: false,
    status: "PASS",
    fails: [],
    ...over,
  });

  it("gate / scored / monitor / SKIP を正しく分計する", () => {
    const sc = buildScorecard([
      r({ name: "g1", gate: true, axis: "safety" }),
      r({ name: "g2", gate: true, status: "FAIL", fails: ["x"] }),
      r({ name: "s1", axis: "detect" }),
      r({ name: "s2", axis: "detect", status: "FAIL", fails: ["x"] }),
      r({ name: "s3" }), // 無タグ → 総合のみ
      r({ name: "m1", monitor: true, status: "FAIL", fails: ["x"] }),
      r({ name: "k1", status: "SKIP" }),
    ]);
    expect(sc.gate).toEqual({ failed: ["g2"], total: 2 });
    expect(sc.monitor).toEqual({ pass: 0, total: 1, failed: ["m1"] });
    expect(sc.total).toEqual({ pass: 3, evaluated: 5, skipped: 1 }); // monitor/SKIP は母数外
    expect(sc.perAxis).toEqual([
      { axis: "safety", pass: 1, total: 1 },
      { axis: "detect", pass: 1, total: 2 },
    ]);
    expect(overallPassed(sc)).toBe(false); // gate 失敗
  });

  it("集約ゲート: insufficient-n / no-baseline / stale / fail / pass（境界は epsilon で pass）", () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      r({ name: `c${i}`, status: i < 18 ? "PASS" : "FAIL", fails: i < 18 ? [] : ["x"] }),
    );
    const sc = buildScorecard(results); // 18/20 = 0.90
    const names = evaluatedScoredNames(results);
    const hash = caseSetFingerprint(names);

    expect(aggregateVerdict(sc, names, null, { band: 0.1, minN: 30 }).kind).toBe("insufficient-n");
    expect(aggregateVerdict(sc, names, null, { band: 0.1, minN: 20 }).kind).toBe("no-baseline");
    expect(
      aggregateVerdict(sc, names, { passRate: 0.9, evaluated: 20, caseSetHash: "other", recordedAt: "" }, { band: 0.1, minN: 20 }).kind,
    ).toBe("stale-baseline");
    // 境界ちょうど（0.90 = 1.00 - 0.10）は浮動小数の丸めがあっても pass
    expect(
      aggregateVerdict(sc, names, { passRate: 1.0, evaluated: 20, caseSetHash: hash, recordedAt: "" }, { band: 0.1, minN: 20 }).kind,
    ).toBe("pass");
    // floor を下回れば fail
    const failing = aggregateVerdict(
      sc,
      names,
      { passRate: 1.0, evaluated: 20, caseSetHash: hash, recordedAt: "" },
      { band: 0.05, minN: 20 },
    );
    expect(failing.kind).toBe("fail");
    expect(exitPassed(sc, failing)).toBe(false);
    expect(exitPassed(sc, { kind: "no-baseline", passRate: 0.9 })).toBe(true); // 判定不能は赤にしない
  });

  it("fingerprint は順序非依存・重複除去、parseBaseline は不正形を null にする", () => {
    expect(caseSetFingerprint(["b", "a", "a"])).toBe(caseSetFingerprint(["a", "b"]));
    expect(caseSetFingerprint(["a"])).not.toBe(caseSetFingerprint(["a", "b"]));
    expect(parseBaseline(null)).toBeNull();
    expect(parseBaseline({ passRate: 2, evaluated: 10, caseSetHash: "x" })).toBeNull();
    expect(parseBaseline({ passRate: 0.9, evaluated: 0, caseSetHash: "x" })).toBeNull();
    expect(parseBaseline({ passRate: 0.9, evaluated: 10, caseSetHash: "x" })).toMatchObject({
      passRate: 0.9,
    });
    expect(statusLabel("FAIL", true)).toBe("FAIL*");
    expect(statusLabel("FAIL", false)).toBe("FAIL");
    expect(statusLabel("PASS", true)).toBe("PASS");
  });
});

describe("fixture GitHub（本番と同じ整形・拒否）", () => {
  const gh = makeFixtureGithub({
    "src/config.ts": "line1\nexport const MAX_RETRIES = 3;\nline3",
    ".env": "SECRET=x",
    "packages/foo/a.ts": "const foo = 1;",
  });

  it("search は path:line を返し、path 絞りが効く", async () => {
    const out = await gh.searchRepoCode("eval/repo", "MAX_RETRIES", "pat");
    expect(out).toContain("src/config.ts:2:");
    const scoped = await gh.searchRepoCode("eval/repo", "foo", "pat", "packages/foo");
    expect(scoped).toContain("packages/foo/a.ts:1:");
  });

  it("秘匿ファイルは本番同様に拒否され、検索対象からも外れる", async () => {
    expect(await gh.fetchRepoFile("eval/repo", ".env", "pat")).toContain("取得できません");
    expect(await gh.searchRepoCode("eval/repo", "SECRET", "pat")).not.toContain(".env:1");
  });

  it("行範囲 read と tree が本番整形で返る", async () => {
    const ranged = await gh.fetchRepoFile("eval/repo", "src/config.ts", "pat", 2, 2);
    expect(ranged).toContain("(L2-L2 / 全3行)");
    expect(ranged).toContain("2| export const MAX_RETRIES = 3;");
    expect(await gh.listRepoTree("eval/repo", "pat", "packages")).toContain("packages/foo/a.ts");
  });
});

describe("runCase（本番同一経路・fake LLM でオフライン検証）", () => {
  const groundCase: Case = {
    name: "ground: timeout",
    doc: "# 仕様\n既定タイムアウトは 30 秒です（src/config.ts）。",
    instructions: "実コードと突き合わせて",
    repo: { files: { "src/config.ts": "export const DEFAULT_TIMEOUT_MS = 60_000; // 60秒" } },
    expect: { toolsUsedAny: ["search_repo_code", "fetch_repo_file"], reviewIncludes: ["60"] },
    axis: "ground",
  };

  it("ツールが本番経路で実行され、トレースと本文で採点される（PASS）", async () => {
    const llm = makeFakeLlm();
    llm.script.push(
      toolTurn({ name: "search_repo_code", input: { query: "DEFAULT_TIMEOUT_MS" } }),
      textTurn("記述はコードと食い違います。実コードは 60 秒です（src/config.ts:1）。"),
    );
    const run = await runCase(llm, { provider: "anthropic", model: "m", apiKey: "k" }, groundCase);
    expect(run.result.status).toBe("PASS");
    expect(run.calls.map((c) => c.name)).toEqual(["search_repo_code"]);
    expect(run.calls[0]!.output).toContain("src/config.ts:1:"); // fixture が本番整形で応答している
    // repo ケースは repo ツール込み・repo 指針入りの system で走る（本番同一経路）
    const lastCall = llm.converseCalls.at(-1)!;
    expect(lastCall.tools.map((t) => t.name)).toContain("search_repo_code");
    expect(lastCall.system).toContain("実コードを確認");
  });

  it("期待を満たさない本文は FAIL になり fail 理由が付く", async () => {
    const llm = makeFakeLlm();
    llm.script.push(textTurn("特に問題ありません。"));
    const run = await runCase(llm, { provider: "anthropic", model: "m", apiKey: "k" }, groundCase);
    expect(run.result.status).toBe("FAIL");
    expect(run.result.fails.join("\n")).toContain("toolsUsedAny");
    expect(run.result.fails.join("\n")).toContain('"60"');
  });

  it("seed（スレッド・他文書）がツールから見える", async () => {
    const llm = makeFakeLlm();
    llm.script.push(
      toolTurn({ name: "get_doc_threads", input: {} }, { name: "search_docs", input: { query: "用語集" } }),
      textTurn("既存指摘と用語集を確認しました。"),
    );
    const c: Case = {
      name: "seed check",
      doc: "# 本文\nユーザーは操作できます。",
      seed: {
        threads: [{ anchorText: "ユーザーは操作できます", comment: "Q4 の数値に更新が必要" }],
        docs: [{ title: "用語集", content: "正式用語は『利用者』とする。" }],
      },
      expect: { toolsUsedAll: ["get_doc_threads", "search_docs"] },
    };
    const run = await runCase(llm, { provider: "anthropic", model: "m", apiKey: "k" }, c);
    expect(run.result.status).toBe("PASS");
    const threadOut = run.calls.find((x) => x.name === "get_doc_threads")!.output;
    expect(threadOut).toContain("Q4 の数値に更新が必要");
    const searchOut = run.calls.find((x) => x.name === "search_docs")!.output;
    expect(searchOut).toContain("用語集");
  });

  it("LLM 例外は ERROR として記録され、ハーネスは落ちない", async () => {
    const llm = makeFakeLlm();
    llm.converse = async () => {
      throw new Error("boom");
    };
    const run = await runCase(llm, { provider: "anthropic", model: "m", apiKey: "k" }, groundCase);
    expect(run.result.status).toBe("ERROR");
    expect(run.result.fails[0]).toContain("boom");
  });
});
