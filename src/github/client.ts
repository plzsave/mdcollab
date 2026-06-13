import type { GithubClient } from "./types";

const API = "https://api.github.com";
const MAX_README = 8000; // プロンプト肥大を避けるため README は先頭のみ採用
const MAX_FILE = 32 * 1024; // tool_result 肥大＝トークン爆発防止（1ファイル32KB上限）
const MAX_TREE = 500; // ツリー一覧の件数上限（同上）

function githubHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "mdcollab",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// fetch_repo_file の path 検証。`..`・絶対パス・URL・空・先頭スラッシュを拒否し、
// 拒否理由を文字列で返す（OK なら null）。リポジトリ越え・SSRF・パストラバーサルを防ぐ。
function rejectPath(path: string): string | null {
  if (typeof path !== "string" || path.trim() === "") return "path が空です";
  const p = path.trim();
  if (p.startsWith("/")) return "絶対パスは指定できません";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return "URL は指定できません";
  if (p.split("/").some((seg) => seg === "..")) return "親ディレクトリ（..）は参照できません";
  return null;
}

// 実 GitHub クライアント（Web 標準 fetch のみ・Workers/Node 共通）。
export function createGithubClient(): GithubClient {
  return {
    async fetchRepoContext(repo, pat) {
      const headers = {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "mdcollab",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      try {
        const metaRes = await fetch(`${API}/repos/${repo}`, { headers });
        if (!metaRes.ok) {
          return `（リポジトリ ${repo} のメタ取得に失敗: HTTP ${metaRes.status}）`;
        }
        const meta = (await metaRes.json()) as { full_name?: string; description?: string };

        let readme = "";
        const readmeRes = await fetch(`${API}/repos/${repo}/readme`, { headers });
        if (readmeRes.ok) {
          const j = (await readmeRes.json()) as { content?: string; encoding?: string };
          if (j.content && j.encoding === "base64") {
            readme = decodeBase64(j.content).slice(0, MAX_README);
          }
        }

        return [
          `リポジトリ: ${meta.full_name ?? repo}`,
          meta.description ? `説明: ${meta.description}` : "",
          readme ? `# README（抜粋）\n${readme}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
      } catch (e) {
        return `（リポジトリ ${repo} の取得でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
      }
    },

    async fetchRepoFile(repo, path, pat) {
      const reason = rejectPath(path);
      if (reason) return `（ファイル取得拒否: ${reason}）`;
      const headers = githubHeaders(pat);
      try {
        const res = await fetch(`${API}/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
          headers,
        });
        if (!res.ok) {
          return `（${repo} の ${path} 取得に失敗: HTTP ${res.status}）`;
        }
        const j = (await res.json()) as { content?: string; encoding?: string; type?: string; size?: number };
        if (j.type !== "file" || j.content == null || j.encoding !== "base64") {
          return `（${repo} の ${path} はテキストファイルとして取得できません）`;
        }
        const text = decodeBase64(j.content);
        return text.length > MAX_FILE ? `${text.slice(0, MAX_FILE)}\n（…32KB で切り詰め）` : text;
      } catch (e) {
        return `（${repo} の ${path} 取得でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
      }
    },

    async listRepoTree(repo, pat) {
      const headers = githubHeaders(pat);
      try {
        // default ブランチを解決してから git/trees を recursive 取得する（HEAD は tree_sha として不安定）。
        const metaRes = await fetch(`${API}/repos/${repo}`, { headers });
        if (!metaRes.ok) return `（${repo} のメタ取得に失敗: HTTP ${metaRes.status}）`;
        const meta = (await metaRes.json()) as { default_branch?: string };
        const branch = meta.default_branch ?? "main";

        const res = await fetch(`${API}/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
          headers,
        });
        if (!res.ok) return `（${repo} のツリー取得に失敗: HTTP ${res.status}）`;
        const j = (await res.json()) as { tree?: { path?: string; type?: string }[]; truncated?: boolean };
        const paths = (j.tree ?? [])
          .filter((t) => t.type === "blob" && t.path)
          .map((t) => t.path as string);
        if (paths.length === 0) return `（${repo} にファイルが見つかりません）`;
        const shown = paths.slice(0, MAX_TREE).join("\n");
        return paths.length > MAX_TREE || j.truncated
          ? `${shown}\n（…一覧を ${MAX_TREE} 件で切り詰め）`
          : shown;
      } catch (e) {
        return `（${repo} のツリー取得でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
      }
    },
  };
}

// GitHub の content は改行入り base64。atob は Workers/Node 双方で利用可。
function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
