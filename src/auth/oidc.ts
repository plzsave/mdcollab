import { createRemoteJWKSet, jwtVerify } from "jose";

// 自前 Google OIDC（Workspace の identity を使うため全ホスティング共通・§7）。
// Cloudflare Access は採らない（ホスティングに剥がせないロックインを作らないため）。
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_ISS = "https://accounts.google.com";
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export interface GoogleClaims {
  sub: string;
  email: string;
  name?: string;
  hd?: string; // Hosted Domain（Workspace ドメイン）
}

export function buildAuthUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export async function exchangeCode(p: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  const body = new URLSearchParams({
    code: p.code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("no id_token in token response");
  return json.id_token;
}

export async function verifyIdToken(
  idToken: string,
  clientId: string,
  expectedNonce?: string,
): Promise<GoogleClaims> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: GOOGLE_ISS,
    audience: clientId,
  });
  if (typeof payload.email !== "string" || typeof payload.sub !== "string") {
    throw new Error("invalid id_token claims");
  }
  // メール未確認のアカウントは受け付けない（なりすまし防止）。
  if (payload.email_verified === false) {
    throw new Error("email not verified");
  }
  // nonce を /login で発行した値と突き合わせ（id_token リプレイ防止）。
  if (expectedNonce !== undefined && payload.nonce !== expectedNonce) {
    throw new Error("nonce mismatch");
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : undefined,
    hd: typeof payload.hd === "string" ? payload.hd : undefined,
  };
}
