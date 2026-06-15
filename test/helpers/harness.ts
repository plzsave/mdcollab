// テスト用ハーネス: 外部サービス不要で本物の Postgres 意味論を使う。
// - DB: pglite（WASM 版 Postgres をプロセス内に起動）に本番と同じ drizzle マイグレーションを適用
// - 本体ストア: メモリ実装の DocumentStore（S3 不要）
// - 認証: 本番と同じ createSession で署名したクッキーを渡す
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../../src/db/schema";
import { createApp } from "../../src/app";
import { createSession } from "../../src/auth/session";
import { SESSION_COOKIE } from "../../src/auth/middleware";
import type { Database } from "../../src/db/client";
import type { DocumentStore } from "../../src/storage/types";
import type { ConverseInput, LlmClient, LlmInput, LlmTurnResult } from "../../src/llm/types";
import type { GithubClient } from "../../src/github/types";
import type { AppConfig, Deps } from "../../src/env";

const TEST_SECRET = "test-secret";

// converse 用のスクリプト 1 ターン。text=テキストで完了、tool=ツール呼び出しを要求。
// usage を付けると converse がそのターンの使用量を返す（合算テスト用）。
export type ScriptTurn =
  | { kind: "text"; text: string; usage?: LlmTurnResult["usage"] }
  | { kind: "tool"; calls: { id?: string; name: string; input: unknown }[]; usage?: LlmTurnResult["usage"] };

export const textTurn = (text: string): ScriptTurn => ({ kind: "text", text });
export const toolTurn = (...calls: { id?: string; name: string; input: unknown }[]): ScriptTurn => ({
  kind: "tool",
  calls,
});

// 既存の textTurn/toolTurn に usage を後付けする（toolTurn が可変長引数なので合成で渡す）。
export const withUsage = (
  turn: ScriptTurn,
  usage: NonNullable<LlmTurnResult["usage"]>,
): ScriptTurn => ({ ...turn, usage });

// messages[0]（user）のテキストブロックを連結（fake のデフォルト応答とアサーション用）。
function firstUserText(messages: unknown[]): string {
  const m0 = messages[0] as { content?: unknown } | undefined;
  if (!m0 || !Array.isArray(m0.content)) return "";
  return (m0.content as { type?: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

export interface FakeLlm extends LlmClient {
  calls: LlmInput[]; // complete/stream の記録（revision など）
  converseCalls: ConverseInput[]; // converse の記録（review/review-repo）
  script: ScriptTurn[]; // 先頭から消費。空ならデフォルト（テキスト1ターン）に縮退
}

/** ネットワーク不要の fake LlmClient。converse はスクリプト駆動でツールループを再現できる。 */
export function makeFakeLlm(): FakeLlm {
  const calls: LlmInput[] = [];
  const converseCalls: ConverseInput[] = [];
  const script: ScriptTurn[] = [];
  return {
    calls,
    converseCalls,
    script,
    async complete(input) {
      calls.push(input);
      return `REVIEW(${input.provider}/${input.model}): ${input.prompt.slice(0, 20)}`;
    },
    async *stream(input) {
      calls.push(input);
      yield "REVIEW ";
      yield "chunk-1 ";
      yield "chunk-2";
    },
    async listModels(provider) {
      return [`${provider}-model-a`, `${provider}-model-b`];
    },
    async converse(input): Promise<LlmTurnResult> {
      converseCalls.push(input);
      const turn = script.shift();
      if (turn?.kind === "tool") {
        const toolCalls = turn.calls.map((c, i) => ({ id: c.id ?? `toolu_${i}`, name: c.name, input: c.input }));
        return {
          text: "",
          toolCalls,
          rawAssistant: {
            role: "assistant",
            content: toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
          },
          usage: turn.usage,
        };
      }
      // text ターン or デフォルト（スクリプト未指定）。デフォルトは単発レビューと等価。
      const text =
        turn?.kind === "text"
          ? turn.text
          : `REVIEW(${input.provider}/${input.model}): ${firstUserText(input.messages).slice(0, 20)}`;
      input.onDelta?.(text);
      return {
        text,
        toolCalls: [],
        rawAssistant: { role: "assistant", content: [{ type: "text", text }] },
        usage: turn?.kind === "text" ? turn.usage : undefined,
      };
    },
  };
}

/** ネットワーク不要の fake GithubClient。(repo, pat) と fetchRepoFile 呼び出しを記録する。 */
export function makeFakeGithub(): GithubClient & {
  calls: { repo: string; pat: string }[];
  fileCalls: { repo: string; path: string; pat: string }[];
  treeCalls: { repo: string; pat: string }[];
} {
  const calls: { repo: string; pat: string }[] = [];
  const fileCalls: { repo: string; path: string; pat: string }[] = [];
  const treeCalls: { repo: string; pat: string }[] = [];
  return {
    calls,
    fileCalls,
    treeCalls,
    async fetchRepoContext(repo, pat) {
      calls.push({ repo, pat });
      return `リポジトリ: ${repo}\n\n# README（抜粋）\nFAKE-README of ${repo}`;
    },
    async fetchRepoFile(repo, path, pat) {
      fileCalls.push({ repo, path, pat });
      return `FAKE-FILE(${repo}:${path})`;
    },
    async listRepoTree(repo, pat) {
      treeCalls.push({ repo, pat });
      return `src/a.ts\nsrc/b.ts\nREADME.md`;
    },
  };
}

/** pglite に本番マイグレーションを適用した drizzle インスタンスを返す。
 *  pglite 版と postgres-js 版は型が別だが、使うクエリビルダ API は同一で実行時挙動も同じ。
 *  本番型(Database)へのキャストはこのテストヘルパー内に閉じ込める。 */
export async function makeTestDb(): Promise<Database> {
  const client = new PGlite(); // 引数なし＝インメモリ（テストごとに独立）
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as Database;
}

/** S3 を使わないインメモリ DocumentStore（backend は "s3" を名乗り本番経路と同じ分岐を通す）。 */
export function makeMemoryStore(): DocumentStore & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    backend: "s3",
    async get(ref) {
      return map.get(ref) ?? "";
    },
    async put(documentId, version, content) {
      const key = `docs/${documentId}/${version}.md`;
      map.set(key, content);
      return key;
    },
    async remove(ref) {
      map.delete(ref);
    },
    dump: () => map,
  };
}

export interface Harness {
  db: Database;
  store: ReturnType<typeof makeMemoryStore>;
  llm: ReturnType<typeof makeFakeLlm>;
  github: ReturnType<typeof makeFakeGithub>;
  config: AppConfig;
  app: ReturnType<typeof createApp>;
  /** email 用の Cookie ヘッダ値（"mdcollab_session=..."）を発行 */
  cookie(email: string, name?: string): Promise<string>;
  /** 認証付きで app.request を呼ぶ薄いラッパ */
  req(path: string, init?: RequestInit & { as?: string }): Promise<Response>;
}

export async function makeHarness(configOverride: Partial<AppConfig> = {}): Promise<Harness> {
  const db = await makeTestDb();
  const store = makeMemoryStore();
  const llm = makeFakeLlm();
  const github = makeFakeGithub();
  const config: AppConfig = {
    baseUrl: "http://localhost",
    sessionSecret: TEST_SECRET,
    encryptionKey: "test-encryption-key",
    google: { clientId: "x", clientSecret: "x" },
    ...configOverride,
  };
  const deps: Deps = { db, store, llm, github, config };
  const app = createApp(deps);

  async function cookie(email: string, name?: string) {
    const token = await createSession({ email, name }, TEST_SECRET);
    return `${SESSION_COOKIE}=${token}`;
  }

  async function req(path: string, init: RequestInit & { as?: string } = {}) {
    const { as, headers, ...rest } = init;
    const h = new Headers(headers);
    if (as) h.set("Cookie", await cookie(as));
    if (rest.body && !h.has("Content-Type")) h.set("Content-Type", "application/json");
    return app.request(path, { ...rest, headers: h });
  }

  return { db, store, llm, github, config, app, cookie, req };
}

/** members に1行入れるショートカット。テストの前提作りに使う。 */
export async function seedMember(
  h: Harness,
  email: string,
  role: "owner" | "member" = "member",
  displayName = email,
) {
  await h.db.insert(schema.members).values({ email, displayName, role });
}
