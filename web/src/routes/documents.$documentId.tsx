import { createFileRoute } from "@tanstack/react-router";
import { useDocument } from "../api/hooks";

// 文書表示（編集・保存・コメント・AI レビューは次の段階で実装）。
export const Route = createFileRoute("/documents/$documentId")({ component: DocumentView });

function DocumentView() {
  const { documentId } = Route.useParams();
  const { data: doc, isLoading, error } = useDocument(documentId);

  if (isLoading) return <p className="text-sm text-slate-400">読み込み中…</p>;
  if (error)
    return (
      <p className="text-sm text-red-600">
        {error instanceof Error ? error.message : "読み込みに失敗しました"}
      </p>
    );
  if (!doc) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">{doc.title}</h1>
        <span className="text-xs text-slate-400">version {doc.version}</span>
      </div>

      <pre className="mt-6 overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-5 font-mono text-sm leading-relaxed text-slate-700">
        {doc.content}
      </pre>
    </div>
  );
}
