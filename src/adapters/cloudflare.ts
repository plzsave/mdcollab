import { createApp } from "../app";
import { createDb } from "../db/client";
import { createStore } from "../storage";
import { createLlmClient } from "../llm/providers";
import { createGithubClient } from "../github/client";
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
  // Workers ネイティブ レート制限バインディング（wrangler.toml の [[ratelimits]]）。
  AUTH_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    // /api/auth/* を IP 単位でレート制限（ログイン連打・コスト保護）。
    // バインディング欠落時はフェイルオープン（締め出しより可用性を優先）。
    const url = new URL(request.url);
    if (env.AUTH_LIMITER && url.pathname.startsWith("/api/auth/")) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.AUTH_LIMITER.limit({ key: ip });
      if (!success) {
        return new Response(
          JSON.stringify({ error: { code: "RATE_LIMITED", message: "too many requests" } }),
          { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } },
        );
      }
    }

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
    return createApp({ db, store, llm: createLlmClient(), github: createGithubClient(), config }).fetch(
      request,
      env,
      ctx,
    );
  },
};
