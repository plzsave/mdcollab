// 秘密（AI APIキー / GitHub PAT）の保存時暗号化（移行計画 §6.5）。
// Web Crypto(AES-GCM 256) のみ＝Workers/Node/Lambda 共通。鍵は ENCRYPTION_KEY を SHA-256 で導出。
// 保存形式は base64(iv[12] || ciphertext)。復号値はクライアントへ返さない不変条件を支える。

async function deriveKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptSecret(plain: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toBase64(out);
}

export async function decryptSecret(enc: string, secret: string): Promise<string> {
  const raw = fromBase64(enc);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const key = await deriveKey(secret);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
