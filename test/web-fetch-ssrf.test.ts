import { describe, it, expect } from "vitest";
import { createWebClient, isBlockedIp, guardUrl } from "../src/web/client";

// web_fetch の SSRF ガード（Phase G2）をネットワークなしで検証する。
// fetchImpl と resolveHost を注入し、(1) スキーム/IP リテラル/localhost の同期ガード、
// (2) 名前解決後 IP 検査（DNS リバインディング対策）、(3) リダイレクト非追跡・非テキスト拒否、
// (4) 正常系を確認する。never throw（拒否・失敗はメモ文字列）。

function res(body: string, init: { status?: number; contentType?: string; contentLength?: string } = {}): Response {
  const headers: Record<string, string> = {};
  if (init.contentType !== undefined) headers["content-type"] = init.contentType;
  if (init.contentLength !== undefined) headers["content-length"] = init.contentLength;
  return new Response(body, { status: init.status ?? 200, headers });
}

describe("isBlockedIp（IP レンジ判定）", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254", // クラウドメタデータ
    "0.0.0.0",
    "100.64.0.1", // CGNAT
    "::1",
    "fe80::1", // link-local
    "fd00::1", // ULA
    "::ffff:127.0.0.1", // IPv4-mapped loopback
  ])("ブロック: %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])(
    "許可: %s",
    (ip) => expect(isBlockedIp(ip)).toBe(false),
  );
});

describe("guardUrl（同期ガード）", () => {
  it("http は拒否", () => expect(guardUrl("http://example.com")).toMatchObject({ reason: expect.stringContaining("https") }));
  it("file は拒否", () => expect("reason" in guardUrl("file:///etc/passwd")).toBe(true));
  it("localhost 名は拒否", () => expect("reason" in guardUrl("https://localhost/")).toBe(true));
  it("メタデータ IP リテラルは拒否", () =>
    expect("reason" in guardUrl("https://169.254.169.254/latest/meta-data/")).toBe(true));
  it("通常の https は許可", () => expect("url" in guardUrl("https://example.com/x")).toBe(true));
});

describe("createWebClient.fetchUrl", () => {
  it("非 https は fetch せず拒否", async () => {
    let called = false;
    const web = createWebClient({ fetchImpl: (async () => ((called = true), res("x"))) as typeof fetch });
    const out = await web.fetchUrl("http://example.com");
    expect(out).toContain("取得拒否");
    expect(called).toBe(false);
  });

  it("IP リテラルの私的アドレスは fetch せず拒否", async () => {
    let called = false;
    const web = createWebClient({ fetchImpl: (async () => ((called = true), res("x"))) as typeof fetch });
    expect(await web.fetchUrl("https://10.0.0.5/secret")).toContain("取得拒否");
    expect(called).toBe(false);
  });

  it("ホスト名がメタデータ IP に解決されたら拒否（DNS リバインディング対策）", async () => {
    let called = false;
    const web = createWebClient({
      fetchImpl: (async () => ((called = true), res("x"))) as typeof fetch,
      resolveHost: async () => ["169.254.169.254"], // 公開ホスト名 → 内部 IP に解決
    });
    const out = await web.fetchUrl("https://evil.example.com/");
    expect(out).toContain("取得拒否");
    expect(out).toContain("メタデータ");
    expect(called).toBe(false);
  });

  it("リダイレクト（3xx）は追跡せず拒否", async () => {
    const web = createWebClient({
      fetchImpl: (async () => res("", { status: 302, contentType: "text/html" })) as typeof fetch,
      resolveHost: async () => ["93.184.216.34"],
    });
    expect(await web.fetchUrl("https://example.com/r")).toContain("リダイレクト");
  });

  it("テキスト以外の Content-Type は拒否", async () => {
    const web = createWebClient({
      fetchImpl: (async () => res("\x00\x01", { contentType: "application/octet-stream" })) as typeof fetch,
      resolveHost: async () => ["93.184.216.34"],
    });
    expect(await web.fetchUrl("https://example.com/bin")).toContain("取得拒否");
  });

  it("正常系: 公開ホストのテキストを取得して返す", async () => {
    let seenUrl = "";
    const web = createWebClient({
      fetchImpl: (async (u: string) => ((seenUrl = u), res("# hello\nworld", { contentType: "text/markdown" }))) as unknown as typeof fetch,
      resolveHost: async () => ["93.184.216.34"],
    });
    const out = await web.fetchUrl("https://example.com/page");
    expect(out).toBe("# hello\nworld");
    expect(seenUrl).toBe("https://example.com/page");
  });

  it("名前解決失敗は拒否（never throw）", async () => {
    const web = createWebClient({
      fetchImpl: (async () => res("x")) as typeof fetch,
      resolveHost: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(await web.fetchUrl("https://nope.invalid/")).toContain("取得拒否");
  });
});
