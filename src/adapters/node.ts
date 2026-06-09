import { serve } from "@hono/node-server";
import { createApp } from "../app";
import { createDb } from "../db/client";
import { createStore } from "../storage";
import { createLlmClient } from "../llm/providers";
import type { AppConfig } from "../env";

// ローカル開発 / 職場 AWS(Fargate/App Runner)用 Node エントリ。
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

const app = createApp({ db, store, llm: createLlmClient(), config });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`mdcollab (node) listening on :${port}`);
