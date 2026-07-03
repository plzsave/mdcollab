// eval のケース実行部（#83）。本番と同一経路でレビューを走らせる:
//   buildSystem + reviewPrompt + 本番のツール群（doc/workspace＋repo）→ runReviewAgent。
// 従来（ツールなしの素レビューのみ）と違い、ツールをラップして呼び出しトレースを記録し、
// 「正しい情報源を見に行ったか」まで採点できる。DB は pglite（テストと同じ・docker 不要）、
// GitHub/web は fixture、LLM だけが呼び出し側から注入される（本物 or fake）。

import { makeMemoryStore, makeTestDb } from "../../test/helpers/harness";
import * as schema from "../../src/db/schema";
import type { AppConfig, Deps } from "../../src/env";
import type { LlmClient, LlmUsage } from "../../src/llm/types";
import { runReviewAgent, type ToolImpl } from "../../src/ai/reviewAgent";
import {
  fetchRepoFileTool,
  getDocThreadsTool,
  getRevisionDiffTool,
  listRepoTreeTool,
  readDocTool,
  searchDocsTool,
  searchRepoCodeTool,
  webFetchTool,
} from "../../src/ai/reviewTools";
import { buildSystem, reviewPrompt } from "../../src/routes/reviews";
import { evalCase, type Call, type Case, type CaseResult } from "./harness";
import { makeFixtureGithub, makeFixtureWeb } from "./fakes";

const EVAL_REPO = "eval/repo"; // fixture リポジトリの表示名（owner/name 形式）
const EVAL_DOC_ID = "eval-doc";
const EVAL_USER = "eval@example.com";

// ツールを包んで呼び出しトレースを記録する（本番コードは無改変のまま引数まで採点できる）。
function recordTool(tool: ToolImpl, calls: Call[]): ToolImpl {
  return {
    def: tool.def,
    async execute(input) {
      const output = await tool.execute(input);
      calls.push({ name: tool.def.name, input, output });
      return output;
    },
  };
}

export interface RunConfig {
  provider: string;
  model: string;
  apiKey: string;
}

export interface CaseRun {
  result: CaseResult;
  calls: Call[];
  text: string;
  usage?: LlmUsage;
  truncated: boolean;
  ms: number;
}

const EVAL_APP_CONFIG: AppConfig = {
  baseUrl: "http://eval.invalid",
  sessionSecret: "eval",
  encryptionKey: "eval",
  google: { clientId: "eval", clientSecret: "eval" },
};

/**
 * 1 ケースを本番同一経路で実行して採点する。
 * DB は pglite をケースごとに初期化（テストハーネスと同じ共有インスタンス＋TRUNCATE）。
 */
export async function runCase(llm: LlmClient, cfg: RunConfig, c: Case): Promise<CaseRun> {
  const db = await makeTestDb();
  const store = makeMemoryStore();
  const github = makeFixtureGithub(c.repo?.files ?? {});
  const web = makeFixtureWeb();
  const deps: Deps = { db, store, llm, github, web, config: EVAL_APP_CONFIG };

  // レビュー対象文書＋seed（他文書・スレッド）を投入する。
  const key = await store.put(EVAL_DOC_ID, 1, c.doc);
  await db.insert(schema.documents).values({
    id: EVAL_DOC_ID,
    title: c.name,
    storageKey: key,
    body: c.doc,
    version: 1,
    createdBy: EVAL_USER,
  });
  for (const [i, d] of (c.seed?.docs ?? []).entries()) {
    const id = `eval-seed-${i}`;
    const seedKey = await store.put(id, 1, d.content);
    await db.insert(schema.documents).values({
      id,
      title: d.title,
      storageKey: seedKey,
      body: d.content,
      version: 1,
      createdBy: EVAL_USER,
    });
  }
  for (const [i, t] of (c.seed?.threads ?? []).entries()) {
    const threadId = `eval-thread-${i}`;
    await db.insert(schema.threads).values({
      id: threadId,
      documentId: EVAL_DOC_ID,
      anchorText: t.anchorText,
      createdBy: EVAL_USER,
    });
    await db.insert(schema.comments).values({
      id: `eval-comment-${i}`,
      threadId,
      content: t.comment,
      author: EVAL_USER,
    });
  }

  // ツール構成は src/routes/reviews.ts の runReview / review-repo と同一。
  const repoTools: ToolImpl[] = c.repo
    ? [
        fetchRepoFileTool(deps, EVAL_REPO, "eval-pat"),
        listRepoTreeTool(deps, EVAL_REPO, "eval-pat"),
        searchRepoCodeTool(deps, EVAL_REPO, "eval-pat"),
      ]
    : [];
  const tools: ToolImpl[] = [
    getDocThreadsTool(deps, EVAL_DOC_ID),
    searchDocsTool(deps, EVAL_DOC_ID),
    readDocTool(deps),
    getRevisionDiffTool(deps, EVAL_DOC_ID),
    webFetchTool(deps),
    ...repoTools,
  ];
  const calls: Call[] = [];
  const wrapped = tools.map((t) => recordTool(t, calls));

  const system = buildSystem(true, repoTools.length > 0);
  const initialPrompt = reviewPrompt(c.doc, c.instructions ?? "", c.repo ? EVAL_REPO : undefined, undefined);

  const t0 = Date.now();
  try {
    const r = await runReviewAgent({
      llm,
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      system,
      initialPrompt,
      tools: wrapped,
      onEvent: () => {},
    });
    const fails = evalCase(c.expect, calls, r.text);
    return {
      result: {
        name: c.name,
        ...(c.axis !== undefined ? { axis: c.axis } : {}),
        gate: c.gate ?? false,
        ...(c.monitor !== undefined ? { monitor: c.monitor } : {}),
        status: fails.length === 0 ? "PASS" : "FAIL",
        fails,
      },
      calls,
      text: r.text,
      ...(r.usage ? { usage: r.usage } : {}),
      truncated: r.truncated,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      result: {
        name: c.name,
        ...(c.axis !== undefined ? { axis: c.axis } : {}),
        gate: c.gate ?? false,
        ...(c.monitor !== undefined ? { monitor: c.monitor } : {}),
        status: "ERROR",
        fails: [e instanceof Error ? e.message : String(e)],
      },
      calls,
      text: "",
      truncated: false,
      ms: Date.now() - t0,
    };
  }
}
