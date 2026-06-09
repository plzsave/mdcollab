import { createApp } from "../app";
import { createDb } from "../db/client";
import { createStore } from "../storage";
import { createLlmClient } from "../llm/providers";
import type { AppConfig } from "../env";

// 個人デプロイ: Cloudflare Workers + Hyperdrive(→Neon) + R2。
// 一番制約のキツい Workers に合わせて書く＝緩い Lambda/Cloud Run へ自動で乗る（§5.1）。
export interface WorkerEnv {
  HYPERDRIVE: { connectionString: string };
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_REGION: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  BASE_URL: string;
  ALLOWED_DOMAIN?: string;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const db = createDb(env.HYPERDRIVE.connectionString);
    const store = createStore({
      backend: "s3",
      endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION || "auto",
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
    const config: AppConfig = {
      baseUrl: env.BASE_URL,
      sessionSecret: env.SESSION_SECRET,
      encryptionKey: env.ENCRYPTION_KEY,
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      allowedDomain: env.ALLOWED_DOMAIN,
    };
    return createApp({ db, store, llm: createLlmClient(), config }).fetch(request, env, ctx);
  },
};
