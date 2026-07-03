// eval 用の fixture 実装（#83）。LLM 以外の外部依存（GitHub / web）はここで差し替え、
// ネットワーク・PAT・レート制限・実リポの変動を eval から排除する（LLM だけが本物）。
// 整形は本番と同じ純関数（src/github/codeSearch.ts）を通し、tool_result の見た目を本番に揃える。

import {
  grepFiles,
  renderTree,
  searchTerms,
  selectSearchCandidates,
  sliceLines,
} from "../../src/github/codeSearch";
import { rejectPath } from "../../src/github/client";
import type { GithubClient } from "../../src/github/types";
import type { WebClient } from "../../src/web/types";

/** ファイル辞書（path → 内容）を実体とする GithubClient。本番と同じ応答整形・path 拒否を再現する。 */
export function makeFixtureGithub(files: Record<string, string>): GithubClient {
  const paths = Object.keys(files);
  return {
    async fetchRepoContext(repo) {
      return `リポジトリ: ${repo}\n説明: eval 用の fixture リポジトリ`;
    },

    async fetchRepoFile(_repo, path, _pat, startLine, endLine) {
      // 本番（src/github/client.ts）と同じ秘匿ファイル/パス拒否（.env 持ち出し等のゲートケースが成立する）。
      const reason = rejectPath(path);
      if (reason) return `（ファイル取得拒否: ${reason}）`;
      const text = files[path];
      if (text == null) return `（eval/repo の ${path} 取得に失敗: HTTP 404）`;
      if (startLine != null) return sliceLines(path, text, startLine, endLine);
      return text;
    },

    async listRepoTree(_repo, _pat, subdir) {
      if (paths.length === 0) return "（eval/repo にファイルが見つかりません）";
      return renderTree(paths, subdir);
    },

    async searchRepoCode(_repo, query, _pat, path) {
      const terms = searchTerms(query);
      if (terms.length === 0) return "（検索語が空でした）";
      const prefix = path ? path.replace(/^\/+|\/+$/g, "") + "/" : "";
      const scoped = paths.filter((p) => (!prefix || p.startsWith(prefix)) && !rejectPath(p));
      const candidates = selectSearchCandidates(scoped, terms);
      const { matches, broadened } = grepFiles(
        candidates.map((p) => ({ path: p, content: files[p]! })),
        terms,
      );
      const scopeNote = path ? `（path:${path}）` : "";
      if (matches.length === 0) {
        return `（"${query}"${scopeNote} に一致する行は見つかりませんでした。path で範囲を絞る・別の語で再検索するか、list_repo_tree で構成を確認して fetch_repo_file で読むこともできます）`;
      }
      const lines = matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n");
      const head = broadened
        ? "一致（いずれかの語・厳密一致なし。fetch_repo_file で確認）:"
        : "一致した箇所（fetch_repo_file で該当ファイルを読む）:";
      return `${head}\n${lines}`;
    },
  };
}

/** web_fetch 用のダミー。eval から外部 HTTP を出さない。 */
export function makeFixtureWeb(): WebClient {
  return {
    async fetchUrl(url) {
      return `（eval fixture: ${url} の取得は eval では無効です）`;
    },
  };
}
