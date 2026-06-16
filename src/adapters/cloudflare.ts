import { createApp } from "../app";
import { createDb } from "../db/client";
import { createStore } from "../storage";
import { createLlmClient } from "../llm/providers";
import { createGithubClient } from "../github/client";
import { createWebClient } from "../web/client";
import type { AppConfig } from "../env";

// Cloudflare デプロイ: Workers + Hyperdrive(→Postgres) + R2。
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
    // Workers のレート制限バインディングは "permissive/結果整合/コロ単位" の best-effort
    // （正確な計数ではない・公式ドキュメント）。持続的な乱用コストを上げる用途。厳密な
    // 制限が要るなら独自ドメイン + WAF レート制限ルール（ゾーン単位）へ。
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
    // Workers は node:dns を持たず、私的ネットワーク/メタデータへの egress もプラットフォームが
    // 既定で遮断する。よって resolveHost は渡さず、同期ガード（https 限定・IP リテラル拒否）に委ねる。
    const web = createWebClient();
    return createApp({
      db,
      store,
      llm: createLlmClient(),
      github: createGithubClient(),
      web,
      config,
    }).fetch(request, env, ctx);
  },
};
