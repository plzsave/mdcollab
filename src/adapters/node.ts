import { serve } from "@hono/node-server";
import { createApp } from "../app";
import { createDb } from "../db/client";
import { createStore } from "../storage";
import { createLlmClient } from "../llm/providers";
import { createGithubClient } from "../github/client";
import { createWebClient } from "../web/client";
import { lookup } from "node:dns/promises";
import type { AppConfig } from "../env";

// ローカル開発 / AWS(Fargate/App Runner) 等の Node エントリ。
// Lambda へ載せる場合は同じ createApp を Lambda アダプタ(hono/aws-lambda)で包む。
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const db = createDb(required("DATABASE_URL"));

const store = createStore({
  backend: "s3",
  endpoint: required("S3_ENDPOINT"),
  bucket: required("S3_BUCKET"),
  region: process.env.S3_REGION ?? "auto",
  accessKeyId: required("S3_ACCESS_KEY_ID"),
  secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
});

// ローカル検証専用（cloudflare アダプタには載せない）。dev 認証時は Google OAuth を使わないので
// GOOGLE_CLIENT_ID/SECRET は必須にしない。実 OIDC を試すときだけ .dev.vars に入れる。
const devAuth = process.env.DEV_AUTH === "1";

const config: AppConfig = {
  baseUrl: process.env.BASE_URL ?? "http://localhost:8787",
  sessionSecret: required("SESSION_SECRET"),
  // 暗号化鍵。未設定ならセッション鍵から派生（dev 用フォールバック）。本番は ENCRYPTION_KEY を設定。
  encryptionKey: process.env.ENCRYPTION_KEY ?? `${required("SESSION_SECRET")}:enc`,
  google: {
    clientId: devAuth ? (process.env.GOOGLE_CLIENT_ID ?? "") : required("GOOGLE_CLIENT_ID"),
    clientSecret: devAuth ? (process.env.GOOGLE_CLIENT_SECRET ?? "") : required("GOOGLE_CLIENT_SECRET"),
  },
  allowedDomain: process.env.ALLOWED_DOMAIN,
  devAuth,
};

// Node では DNS 解決を渡す＝web_fetch がホスト名解決後の IP で SSRF 判定できる（リバインディング対策）。
// AWS/Fargate は 169.254.169.254 メタデータに到達しうるため、この検査が効く。
const web = createWebClient({
  resolveHost: async (host) => (await lookup(host, { all: true })).map((r) => r.address),
});

const app = createApp({ db, store, llm: createLlmClient(), github: createGithubClient(), web, config });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`mdcollab (node) listening on :${port}`);
