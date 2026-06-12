import type { GithubClient } from "./types";

const API = "https://api.github.com";
const MAX_README = 8000; // プロンプト肥大を避けるため README は先頭のみ採用

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
  };
}

// GitHub の content は改行入り base64。atob は Workers/Node 双方で利用可。
function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
