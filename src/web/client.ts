import type { WebClient } from "./types";

// web_fetch の SSRF ガード付きクライアント（自前実装＝provider 非依存・deps 注入でテスト可）。
// 文書本文は信頼できない入力なので web_fetch は新たな攻撃面。https 限定・私的/メタデータ IP 拒否・
// 名前解決後の IP 検査（DNS リバインディング対策）・リダイレクト非追跡・サイズ/タイムアウト/テキストのみ。

const MAX_BYTES = 64 * 1024; // Content-Length での足切り
const MAX_CHARS = 64 * 1024; // 本文返却の文字数上限（トークン爆発防止）
const TIMEOUT_MS = 5000;

// ── IP レンジ判定（純粋関数・テスト対象）─────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1, 5).map(Number);
  if (o.some((n) => n > 255)) return null;
  return ((o[0]! << 24) >>> 0) + (o[1]! << 16) + (o[2]! << 8) + o[3]!;
}

function inV4(ipInt: number, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const baseInt = ipv4ToInt(base!)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

// 私的・ループバック・リンクローカル（=クラウドメタデータ 169.254.169.254）・予約・CGNAT・マルチキャスト。
const V4_BLOCKED = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n == null) return false;
  return V4_BLOCKED.some((c) => inV4(n, c));
}

function isBlockedIpv6(ip: string): boolean {
  const s = (ip.split("%")[0] ?? "").toLowerCase(); // zone id を除去
  const mapped = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // IPv4-mapped
  if (mapped) return isBlockedIpv4(mapped[1]!);
  if (s === "::1" || s === "::") return true; // loopback / unspecified
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // fc00::/7 ULA
  if (/^fe[89ab]/.test(s)) return true; // fe80::/10 link-local
  return false;
}

/** プライベート/ループバック/リンクローカル/メタデータ等の到達禁止 IP か。 */
export function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

// ホスト名の即時拒否リスト（DNS 解決前の防御。解決でも 169.254.x は捕捉されるが二重に弾く）。
const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "metadata.google.internal"]);

type Guarded = { url: URL; host: string } | { reason: string };

// URL の形式・スキーム・IP リテラル/localhost を検査（DNS 解決前の同期ガード）。
export function guardUrl(raw: string): Guarded {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "URL の形式が不正です" };
  }
  if (url.protocol !== "https:") return { reason: "https の URL のみ取得できます" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // IPv6 の角括弧を除去
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost")) {
    return { reason: "ローカルホストは取得できません" };
  }
  const isIpLiteral = ipv4ToInt(host) != null || host.includes(":");
  if (isIpLiteral && isBlockedIp(host)) {
    return { reason: "プライベート/ループバック等の IP は取得できません" };
  }
  return { url, host };
}

const TEXT_CT = /^(text\/|application\/(json|xml|xhtml\+xml|[\w.-]*\+json|[\w.-]*\+xml))/i;

export interface WebClientOpts {
  /** 差し替え可能な fetch（テスト用）。既定はグローバル fetch。 */
  fetchImpl?: typeof fetch;
  /**
   * ホスト名→IP[] の解決（DNS リバインディング対策の名前解決後検査用）。
   * Node アダプタが node:dns を渡す。未指定（Workers 等）なら DNS 検査はスキップし、
   * 同期ガード＋プラットフォームの私的 egress 遮断に委ねる。
   */
  resolveHost?: (host: string) => Promise<string[]>;
}

// レスポンスボディをストリームで読み、MAX_BYTES（実バイト）/ MAX_CHARS（デコード後文字数）で
// 二重に頭打ちする。上限到達時は ctrl.abort() で残りの受信を止め、切り詰めマーカーを付けて返す。
// body が無い実装（古い fetch 等）では res.text() にフォールバックする。
async function readTextCapped(res: Response, ctrl: AbortController): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n（…切り詰め）` : text;
  }
  const decoder = new TextDecoder();
  let received = 0;
  let out = "";
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const before = received;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        const allowed = Math.max(0, MAX_BYTES - before);
        out += decoder.decode(value.slice(0, allowed), { stream: true });
        truncated = true;
        ctrl.abort();
        break;
      }
      out += decoder.decode(value, { stream: true });
      if (out.length > MAX_CHARS) {
        truncated = true;
        ctrl.abort();
        break;
      }
    }
  }
  out += decoder.decode(); // フラッシュ（末尾のマルチバイト境界）
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS);
    truncated = true;
  }
  return truncated ? `${out}\n（…切り詰め）` : out;
}

export function createWebClient(opts: WebClientOpts = {}): WebClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const resolveHost = opts.resolveHost;
  return {
    async fetchUrl(raw) {
      const g = guardUrl(raw);
      if ("reason" in g) return `（取得拒否: ${g.reason}）`;
      const { url, host } = g;

      // ホスト名なら解決後 IP を検査（DNS リバインディング対策）。resolver が無ければスキップ。
      const isIpLiteral = ipv4ToInt(host) != null || host.includes(":");
      if (resolveHost && !isIpLiteral) {
        let ips: string[];
        try {
          ips = await resolveHost(host);
        } catch {
          return "（取得拒否: 名前解決に失敗しました）";
        }
        if (ips.length === 0) return "（取得拒否: 名前解決に失敗しました）";
        if (ips.some(isBlockedIp)) return "（取得拒否: 解決先がプライベート/メタデータ IP です）";
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await doFetch(url.toString(), {
          method: "GET",
          redirect: "manual", // リダイレクトは追わない（追跡先で再度ガードを通さないため）
          signal: ctrl.signal,
          headers: { "user-agent": "mdcollab", accept: "text/*, application/json" },
        });
        if (res.status >= 300 && res.status < 400) return "（取得拒否: リダイレクトは追跡しません）";
        if (!res.ok) return `（取得に失敗: HTTP ${res.status}）`;
        const ct = res.headers.get("content-type") ?? "";
        if (!TEXT_CT.test(ct)) return `（取得拒否: テキスト以外の Content-Type です: ${ct || "不明"}）`;
        // Content-Length が宣言されていて上限超ならボディを読まず拒否（早期足切り）。
        if (Number(res.headers.get("content-length") ?? "0") > MAX_BYTES) {
          return `（取得拒否: サイズ上限 ${MAX_BYTES / 1024}KB を超えます）`;
        }
        // Content-Length は不在/偽装され得る（chunked 等）ので、実バイトをストリームで積算しながら
        // MAX_BYTES を超えた時点で abort して打ち切る。res.text() で全体をメモリに展開すると
        // 悪意あるリンク先が Workers の isolate メモリ(128MB)を圧迫し得るため（#47）。
        return await readTextCapped(res, ctrl);
      } catch (e) {
        const msg =
          e instanceof Error && e.name === "AbortError"
            ? "タイムアウト"
            : e instanceof Error
              ? e.message
              : "unknown";
        return `（取得でエラー: ${msg}）`;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
