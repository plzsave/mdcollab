import { SignJWT, jwtVerify } from "jose";

// 自前セッション(Cookie)。jose は Web Crypto ベースで Workers/Node/Lambda 共通（§7.1）。
const ALG = "HS256";
const TTL = "7d";

export interface SessionData {
  email: string;
  name?: string;
}

export async function createSession(data: SessionData, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ email: data.email, name: data.name })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(key);
}

export async function verifySession(token: string, secret: string): Promise<SessionData | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
    if (typeof payload.email !== "string") return null;
    return {
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}
