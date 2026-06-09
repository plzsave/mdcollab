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
import type { LlmClient, LlmInput } from "../../src/llm/types";
import type { AppConfig, Deps } from "../../src/env";

const TEST_SECRET = "test-secret";

/** ネットワーク不要の fake LlmClient。最後の入力を記録し、固定テキストを返す/流す。 */
export function makeFakeLlm(): LlmClient & { calls: LlmInput[] } {
  const calls: LlmInput[] = [];
  return {
    calls,
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
  config: AppConfig;
  app: ReturnType<typeof createApp>;
  /** email 用の Cookie ヘッダ値（"mdcollab_session=..."）を発行 */
  cookie(email: string, name?: string): Promise<string>;
  /** 認証付きで app.request を呼ぶ薄いラッパ */
  req(path: string, init?: RequestInit & { as?: string }): Promise<Response>;
}

export async function makeHarness(): Promise<Harness> {
  const db = await makeTestDb();
  const store = makeMemoryStore();
  const llm = makeFakeLlm();
  const config: AppConfig = {
    baseUrl: "http://localhost",
    sessionSecret: TEST_SECRET,
    encryptionKey: "test-encryption-key",
    google: { clientId: "x", clientSecret: "x" },
  };
  const deps: Deps = { db, store, llm, config };
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

  return { db, store, llm, config, app, cookie, req };
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
