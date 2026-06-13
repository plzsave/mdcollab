import { and, desc, eq, ilike, inArray, ne } from "drizzle-orm";
import type { Deps } from "../env";
import { comments, documents, threads } from "../db/schema";
import type { ToolImpl } from "./reviewAgent";

// レビューエージェントのツール工場。ルートが deps / 対象 doc / repo / pat を捕捉して組み立てる
// （レジストリはルートの責務・ループはプロバイダ非依存に保つ）。
// execute は never throw＝失敗はメモ文字列を tool_result でモデルへ返し、再試行/断念させる（§9・既存契約）。

const MAX_DOCS = 20; // search_docs の返却上限（トークン爆発防止）
const MAX_THREADS = 50; // get_doc_threads の返却上限

function strInput(input: unknown, key: string): string | null {
  const v = (input as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : null;
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

// search_docs: ワークスペース内の文書をタイトル検索（members 限定）。関連文書を見つけるため。
// 本文は R2/GCS にあり DB は title のみ＝検索対象はタイトル。LIKE 値は drizzle がパラメータ化（注入安全）。
export function searchDocsTool(deps: Deps, currentDocId: string): ToolImpl {
  return {
    def: {
      name: "search_docs",
      description:
        "ワークスペース内の他の文書をタイトルで検索する。関連文書や参照先を見つけて整合性を確認したいときに呼ぶ。",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "タイトルに含まれる語" } },
        required: ["query"],
      },
    },
    async execute(input) {
      const query = strInput(input, "query");
      if (query == null || query.trim() === "") return "（不正な入力: query を文字列で指定してください）";
      try {
        const rows = await deps.db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(
            and(
              ilike(documents.title, `%${query.trim()}%`),
              eq(documents.archived, false),
              ne(documents.id, currentDocId),
            ),
          )
          .limit(MAX_DOCS);
        if (rows.length === 0) return `（「${query.trim()}」に一致する文書はありません）`;
        return rows.map((r) => `- ${r.title} (id: ${r.id})`).join("\n");
      } catch (e) {
        return `（文書検索でエラー: ${e instanceof Error ? e.message : "unknown"}）`;
      }
    },
  };
}
