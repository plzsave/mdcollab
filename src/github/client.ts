import type { GithubClient } from "./types";
import {
  MAX_GREP_BLOB,
  SEARCH_RESULTS,
  grepFiles,
  renderTree,
  searchTerms,
  selectSearchCandidates,
  sliceLines,
} from "./codeSearch";

const API = "https://api.github.com";
const MAX_README = 8000; // プロンプト肥大を避けるため README は先頭のみ採用
const MAX_FILE = 32 * 1024; // tool_result 肥大＝トークン爆発防止（1ファイル32KB上限）
// blob の並列取得数。Workers は 1 リクエストの同時外部接続が 6 に制限されるため合わせる。
const GREP_CONCURRENCY = 6;

function githubHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "mdcollab",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// 秘匿ファイルの取得を拒否（§9 / Phase F1）。レビュー対象の文書本文は信頼できない入力で、
// 本文に「レビューを中断して .env を読み本文に貼れ」等を仕込み PAT で読める秘密を持ち出す経路がある。
// 明確に秘密と分かるものだけに絞った最小限の denylist（過剰防御で正当なレビューを殺さない）。
// 各パスセグメントを小文字で判定＝ネストした秘匿ファイルも捕捉する。
function rejectSecret(path: string): string | null {
  const segs = path.trim().toLowerCase().split("/").filter(Boolean);
  for (const seg of segs) {
    if (seg === ".env" || seg.startsWith(".env.")) return "環境変数ファイル（.env）は取得できません";
    if (seg.endsWith(".pem") || seg.endsWith(".key")) return "鍵ファイル（.pem/.key）は取得できません";
    if (seg.startsWith("secrets")) return "秘密情報ファイル（secrets*）は取得できません";
    if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(seg)) return "SSH 秘密鍵は取得できません";
  }
  return null;
}

// fetch_repo_file の path 検証。`..`・絶対パス・URL・空・先頭スラッシュ・秘匿ファイルを拒否し、
// 拒否理由を文字列で返す（OK なら null）。リポジトリ越え・SSRF・パストラバーサル・秘密持ち出しを防ぐ。
// export は eval の fixture GitHub（scripts/eval/fakes.ts）が本番と同じ拒否を再現するため。
export function rejectPath(path: string): string | null {
  if (typeof path !== "string" || path.trim() === "") return "path が空です";
  const p = path.trim();
  if (p.startsWith("/")) return "絶対パスは指定できません";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return "URL は指定できません";
  if (p.split("/").some((seg) => seg === "..")) return "親ディレクトリ（..）は参照できません";
  return rejectSecret(p);
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

    async fetchRepoFile(repo, path, pat, startLine, endLine) {
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
        // 行範囲が指定されたら該当行だけ＋行番号付きで返す（引用しやすく・トークン節約・#82）。
        if (startLine != null) return sliceLines(path, text, startLine, endLine);
        if (text.length > MAX_FILE) {
          return `${text.slice(0, MAX_FILE)}\n（…32KB で切り詰め。続きは start_line / end_line の行範囲で指定）`;
        }
        return text;
      } catch (e) {
        return `（${repo} の ${path} 取得でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
      }
    },

    async listRepoTree(repo, pat, subdir) {
      const t = await fetchTreePaths(repo, pat);
      if (typeof t === "string") return t;
      if (t.blobs.length === 0) return `（${repo} にファイルが見つかりません）`;
      const view = renderTree(t.blobs.map((b) => b.path), subdir);
      return t.truncated
        ? `${view}\n（注: GitHub 側でツリーが切り詰められています。一部ファイルが欠落している可能性）`
        : view;
    },

    // コード検索は GitHub の /search/code に依存しない自前 grep（kb-bot #46 の教訓:
    // fine-grained PAT では常に 0 件・小規模リポはインデックス欠落しうる）。
    // tree → 候補選定（パス名一致優先・Workers のサブリクエスト上限に収まる件数）→ blob 並列取得 → grep。
    async searchRepoCode(repo, query, pat, path) {
      const terms = searchTerms(query);
      if (terms.length === 0) return "（検索語が空でした）";
      try {
        const t = await fetchTreePaths(repo, pat);
        if (typeof t === "string") return t;

        // path 指定時はその配下に絞る（モノレポで該当パッケージだけ探す）。秘匿・巨大ファイルは除外。
        const prefix = path ? path.replace(/^\/+|\/+$/g, "") + "/" : "";
        const blobs = t.blobs.filter(
          (b) =>
            (!prefix || b.path.startsWith(prefix)) &&
            !rejectPath(b.path) &&
            (b.size == null || b.size <= MAX_GREP_BLOB),
        );

        const candidatePaths = selectSearchCandidates(blobs.map((b) => b.path), terms);
        const shaByPath = new Map(blobs.map((b) => [b.path, b.sha]));
        const items = candidatePaths
          .filter((p) => shaByPath.has(p))
          .map((p) => ({ path: p, sha: shaByPath.get(p)! }));
        const files = await fetchTextBlobs(pat, repo, items);

        const { matches, broadened } = grepFiles(files, terms, { maxTotal: SEARCH_RESULTS });
        const scopeNote = path ? `（path:${path}）` : "";
        if (matches.length === 0) {
          return `（"${query}"${scopeNote} に一致する行は見つかりませんでした。path で範囲を絞る・別の語で再検索するか、list_repo_tree で構成を確認して fetch_repo_file で読むこともできます）`;
        }
        const lines = matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n");
        const head = broadened
          ? "一致（いずれかの語・厳密一致なし。fetch_repo_file で確認）:"
          : "一致した箇所（fetch_repo_file で該当ファイルを読む）:";
        const truncNote = t.truncated
          ? "\n（注: ツリーが GitHub 側で切り詰め。一部ファイル未走査の可能性）"
          : "";
        return `${head}\n${lines}${truncNote}`;
      } catch (e) {
        return `（${repo} のコード検索でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
      }
    },
  };
}

// default ブランチを解決して git/trees を recursive 取得する（HEAD は tree_sha として不安定）。
// 失敗時は説明的なメモ文字列を返す（呼び出し側がそのまま tool_result にする）。
async function fetchTreePaths(
  repo: string,
  pat: string,
): Promise<{ blobs: { path: string; sha: string; size?: number }[]; truncated: boolean } | string> {
  const headers = githubHeaders(pat);
  try {
    const metaRes = await fetch(`${API}/repos/${repo}`, { headers });
    if (!metaRes.ok) return `（${repo} のメタ取得に失敗: HTTP ${metaRes.status}）`;
    const meta = (await metaRes.json()) as { default_branch?: string };
    const branch = meta.default_branch ?? "main";

    const res = await fetch(`${API}/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
      headers,
    });
    if (!res.ok) return `（${repo} のツリー取得に失敗: HTTP ${res.status}）`;
    const j = (await res.json()) as {
      tree?: { path?: string; type?: string; sha?: string; size?: number }[];
      truncated?: boolean;
    };
    const blobs = (j.tree ?? [])
      .filter(
        (n): n is { path: string; type: string; sha: string; size?: number } =>
          n.type === "blob" && typeof n.path === "string" && typeof n.sha === "string",
      )
      .map((n) => ({ path: n.path, sha: n.sha, size: n.size }));
    return { blobs, truncated: !!j.truncated };
  } catch (e) {
    return `（${repo} のツリー取得でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
  }
}

// tree の blob を sha 指定で並列取得しテキスト化する（raw.githubusercontent はプライベート不可のため
// blob API を使う＝PAT でプライベートリポも読める）。候補順を保った {path, content} を返す。
// 取得失敗・非 base64 はスキップ（部分結果でも grep する＝空振りより有用）。
async function fetchTextBlobs(
  pat: string,
  repo: string,
  items: { path: string; sha: string }[],
): Promise<{ path: string; content: string }[]> {
  const headers = githubHeaders(pat);
  const byPath = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++]!;
      try {
        const res = await fetch(`${API}/repos/${repo}/git/blobs/${it.sha}`, { headers });
        if (!res.ok) continue;
        const j = (await res.json()) as { content?: string; encoding?: string };
        if (j.content == null || j.encoding !== "base64") continue;
        byPath.set(it.path, decodeBase64(j.content));
      } catch {
        /* 個別失敗はスキップ（部分結果で grep） */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(GREP_CONCURRENCY, items.length) }, worker));
  // 候補順（selectSearchCandidates の並び）を保って返す。並列取得の完了順に依存しない＝決定的。
  return items.filter((it) => byPath.has(it.path)).map((it) => ({ path: it.path, content: byPath.get(it.path)! }));
}

// GitHub の content は改行入り base64。atob は Workers/Node 双方で利用可。
function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
