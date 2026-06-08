import { serve } from "@hono/node-server";
import { createApp } from "../app";
import { createDb } from "../db/client";
import { createStore } from "../storage";
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

const config: AppConfig = {
  baseUrl: process.env.BASE_URL ?? "http://localhost:8787",
  sessionSecret: required("SESSION_SECRET"),
  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
  },
  allowedDomain: process.env.ALLOWED_DOMAIN,
};

const app = createApp({ db, store, config });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`mdcollab (node) listening on :${port}`);
