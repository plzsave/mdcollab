import { and, desc, eq, ilike, inArray, ne, or } from "drizzle-orm";
import type { Deps } from "../env";
import { comments, documents, documentVersions, threads } from "../db/schema";
import type { ToolImpl } from "./reviewAgent";

// レビューエージェントのツール工場。ルートが deps / 対象 doc / repo / pat を捕捉して組み立てる
// （レジストリはルートの責務・ループはプロバイダ非依存に保つ）。
// execute は never throw＝失敗はメモ文字列を tool_result でモデルへ返し、再試行/断念させる（§9・既存契約）。

const MAX_DOCS = 20; // search_docs の返却上限（トークン爆発防止）
const MAX_THREADS = 50; // get_doc_threads の返却上限
const SNIPPET_RADIUS = 100; // 一致箇所の前後文字数（スニペット長を固定＝トークン爆発防止）
const MAX_DOC_CHARS = 32 * 1024; // read_doc の全文返却上限（fetch_repo_file と同じ 32KB 目安）
const MAX_DIFF_LINES = 1000; // get_revision_diff の各版比較行数上限（LCS の O(n*m) を抑える）
const MAX_DIFF_CHARS = 16 * 1024; // 差分の返却文字数上限（トークン爆発防止）
const DIFF_CONTEXT = 2; // 差分の変更行まわりに残す文脈行数

// body 中の query 一致箇所の前後を抜き出した 1 行スニペットを返す（無一致は空文字）。
// 本文を丸ごと返すとトークンが爆発するため、必ず一致周辺だけに切り詰める。
function makeSnippet(body: string | null, query: string): string {
  if (!body) return "";
  const i = body.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return ""; // 本文に無い（＝タイトル一致）ならスニペットなし
  const start = Math.max(0, i - SNIPPET_RADIUS);
  const end = Math.min(body.length, i + query.length + SNIPPET_RADIUS);
  const core = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${core}${end < body.length ? "…" : ""}`;
}

function strInput(input: unknown, key: string): string | null {
  const v = (input as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : null;
}

// 前版→現版の行単位 diff（LCS）。各版を MAX_DIFF_LINES 行に切り詰めてから比較し、
// 変更行のまわり DIFF_CONTEXT 行だけ残して未変更の長い連続は「…」に畳む（トークン爆発防止）。
function lineDiff(oldText: string, newText: string): string {
  const cap = (s: string) => {
    const lines = s.split("\n");
    return { lines: lines.slice(0, MAX_DIFF_LINES), truncated: lines.length > MAX_DIFF_LINES };
  };
  const a = cap(oldText);
  const b = cap(newText);
  const x = a.lines;
  const y = b.lines;
  const n = x.length;
  const m = y.length;

  // LCS 長テーブル（末尾から）。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  // タグ付き行列（" "=文脈 / "-"=削除 / "+"=追加）を復元。
  const tagged: { tag: " " | "-" | "+"; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      tagged.push({ tag: " ", line: x[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      tagged.push({ tag: "-", line: x[i++]! });
    } else {
      tagged.push({ tag: "+", line: y[j++]! });
    }
  }
  while (i < n) tagged.push({ tag: "-", line: x[i++]! });
  while (j < m) tagged.push({ tag: "+", line: y[j++]! });

  if (!tagged.some((t) => t.tag !== " ")) return "（前版との差分はありません）";

  // 変更行の周辺だけ残す（未変更の長い連続は畳む）。
  const keep = new Array(tagged.length).fill(false);
  tagged.forEach((t, idx) => {
    if (t.tag === " ") return;
    for (let k = idx - DIFF_CONTEXT; k <= idx + DIFF_CONTEXT; k++) {
      if (k >= 0 && k < tagged.length) keep[k] = true;
    }
  });
  const lines: string[] = [];
  let gap = false;
  tagged.forEach((t, idx) => {
    if (keep[idx]) {
      lines.push(`${t.tag} ${t.line}`);
      gap = false;
    } else if (!gap) {
      lines.push("…");
      gap = true;
    }
  });
  if (a.truncated || b.truncated) lines.push(`（…比較は各版先頭 ${MAX_DIFF_LINES} 行まで）`);

  let text = lines.join("\n");
  if (text.length > MAX_DIFF_CHARS) text = `${text.slice(0, MAX_DIFF_CHARS)}\n（…差分を切り詰め）`;
  return text;
}

// fetch_repo_file: 参照リポジトリ内の単一ファイル（固定 repo・PAT）。Phase A から移設。
export function fetchRepoFileTool(deps: Deps, repo: string, pat: string): ToolImpl {
  return {
    def: {
      name: "fetch_repo_file",
      description:
        "参照リポジトリ内の単一ファイルの内容を取得する。文書が参照する実コードを確認したいときにのみ呼ぶ。",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "リポジトリ内のファイルパス（例: src/foo.ts）" } },
        required: ["path"],
      },
    },
    async execute(input) {
      const path = strInput(input, "path");
      if (path == null) return "（不正な入力: path は文字列で指定してください）";
      return deps.github.fetchRepoFile(repo, path, pat);
    },
  };
}

// list_repo_tree: 参照リポジトリのファイルツリー（固定 repo・PAT）。どのファイルがあるか俯瞰してから読むため。
export function listRepoTreeTool(deps: Deps, repo: string, pat: string): ToolImpl {
  return {
    def: {
      name: "list_repo_tree",
      description:
        "参照リポジトリのファイル一覧（パス）を取得する。どのファイルを fetch_repo_file で読むか当たりをつけたいときに呼ぶ。",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    async execute() {
      return deps.github.listRepoTree(repo, pat);
    },
  };
}

// get_doc_threads: レビュー中の文書のコメントスレッド＋本文。requireMember 済みの当該 doc に限定。
export function getDocThreadsTool(deps: Deps, documentId: string): ToolImpl {
  return {
    def: {
      name: "get_doc_threads",
      description:
        "レビュー中の文書に付いたコメントスレッド（指摘箇所・本文）を取得する。既存の議論や未解決の指摘を踏まえてレビューしたいときに呼ぶ。",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    async execute() {
      try {
        const ths = await deps.db
          .select()
          .from(threads)
          .where(eq(threads.documentId, documentId))
          .orderBy(desc(threads.createdAt))
          .limit(MAX_THREADS);
        if (ths.length === 0) return "（この文書にコメントスレッドはありません）";

        const cs = await deps.db
          .select()
          .from(comments)
          .where(
            and(
              inArray(
                comments.threadId,
                ths.map((t) => t.id),
              ),
              eq(comments.deleted, false),
            ),
          )
          .orderBy(comments.createdAt);

        const byThread = new Map<string, typeof cs>();
        for (const c of cs) {
          const arr = byThread.get(c.threadId) ?? [];
          arr.push(c);
          byThread.set(c.threadId, arr);
        }

        return ths
          .map((t) => {
            const head = `[${t.status}] アンカー: ${t.anchorText}`;
            const body = (byThread.get(t.id) ?? []).map((c) => `  - ${c.author}: ${c.content}`).join("\n");
            return body ? `${head}\n${body}` : head;
          })
          .join("\n\n");
      } catch (e) {
        return `（スレッド取得でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
      }
    },
  };
}

// search_docs: ワークスペース内の文書をタイトル＋本文で検索（members 限定）。関連文書を見つけるため。
// 本文は保存時に同期した documents.body を検索（本体は R2/GCS）。LIKE 値は drizzle がパラメータ化（注入安全）。
// トークン爆発を避けるため、本文は丸ごと返さず一致箇所のスニペットだけを返す（件数・長さ上限つき）。
export function searchDocsTool(deps: Deps, currentDocId: string): ToolImpl {
  return {
    def: {
      name: "search_docs",
      description:
        "ワークスペース内の他の文書をタイトルと本文で検索し、一致箇所の抜粋を返す。関連文書や参照先を見つけて整合性を確認したいときに呼ぶ。",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "タイトルまたは本文に含まれる語" } },
        required: ["query"],
      },
    },
    async execute(input) {
      const query = strInput(input, "query")?.trim();
      if (!query) return "（不正な入力: query を文字列で指定してください）";
      try {
        const rows = await deps.db
          .select({ id: documents.id, title: documents.title, body: documents.body })
          .from(documents)
          .where(
            and(
              or(ilike(documents.title, `%${query}%`), ilike(documents.body, `%${query}%`)),
              eq(documents.archived, false),
              ne(documents.id, currentDocId),
            ),
          )
          .limit(MAX_DOCS);
        if (rows.length === 0) return `（「${query}」に一致する文書はありません）`;
        return rows
          .map((r) => {
            const snippet = makeSnippet(r.body, query);
            return snippet ? `- ${r.title} (id: ${r.id})\n  ${snippet}` : `- ${r.title} (id: ${r.id})`;
          })
          .join("\n");
      } catch (e) {
        return `（文書検索でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
      }
    },
  };
}

// read_doc: ワークスペース内の他文書の全文（members 限定・ルートが認可済み）。
// search_docs のスニペットでは足りず全文確認したいときに。サイズ上限つき（トークン爆発防止）。
export function readDocTool(deps: Deps): ToolImpl {
  return {
    def: {
      name: "read_doc",
      description:
        "ワークスペース内の文書の全文を取得する。search_docs が返したヒット文書を、スニペットでは足りず全文で確認したいときに id を指定して呼ぶ。",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "search_docs が返した文書 id" } },
        required: ["id"],
      },
    },
    async execute(input) {
      const id = strInput(input, "id");
      if (!id) return "（不正な入力: id を文字列で指定してください）";
      try {
        const [doc] = await deps.db.select().from(documents).where(eq(documents.id, id)).limit(1);
        if (!doc) return `（id: ${id} の文書は見つかりません）`;
        const ref = doc.storageKey ?? doc.driveFileId;
        const content = ref ? await deps.store.get(ref) : "";
        const capped =
          content.length > MAX_DOC_CHARS ? `${content.slice(0, MAX_DOC_CHARS)}\n（…32KB で切り詰め）` : content;
        return `# ${doc.title} (id: ${doc.id})\n\n${capped}`;
      } catch (e) {
        return `（文書取得でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
      }
    },
  };
}

// web_fetch: 文書内の外部リンク（https）の内容を取得（SSRF ガードは deps.web 側）。
// 本文は信頼できない入力＝攻撃面なので、ガード済みの WebClient 越しにのみ取得する。
export function webFetchTool(deps: Deps): ToolImpl {
  return {
    def: {
      name: "web_fetch",
      description:
        "文書内の外部リンク（https の URL）の内容を取得して確認する。本文が参照する外部ページの生存や内容を確かめたいときにのみ呼ぶ。",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "取得する https URL" } },
        required: ["url"],
      },
    },
    async execute(input) {
      const url = strInput(input, "url");
      if (!url) return "（不正な入力: url を文字列で指定してください）";
      return deps.web.fetchUrl(url);
    },
  };
}

// get_revision_diff: レビュー中の文書の前版→現版の差分（当該 doc 限定）。
// 版ごとに storageKey を持つ documentVersions から直近 2 版を読み行 diff を返す。
export function getRevisionDiffTool(deps: Deps, documentId: string): ToolImpl {
  return {
    def: {
      name: "get_revision_diff",
      description:
        "レビュー中の文書の、前版から現版への変更（差分）を取得する。『前回からの変更だけ見て』のように直近の修正点に絞ってレビューしたいときに呼ぶ。",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    async execute() {
      try {
        const vers = await deps.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.documentId, documentId))
          .orderBy(desc(documentVersions.version))
          .limit(2);
        if (vers.length < 2) return "（前版がありません＝差分を取得できません）";
        const read = async (v: (typeof vers)[number]) => {
          const ref = v.storageKey ?? v.driveFileId;
          return ref ? deps.store.get(ref) : "";
        };
        const [curText, prevText] = await Promise.all([read(vers[0]!), read(vers[1]!)]);
        return lineDiff(prevText, curText);
      } catch (e) {
        return `（差分取得でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
      }
    },
  };
}
