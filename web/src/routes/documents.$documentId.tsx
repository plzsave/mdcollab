import { createFileRoute } from "@tanstack/react-router";
import { useDocument } from "../api/hooks";
import { MarkdownEditor } from "../components/MarkdownEditor";

export const Route = createFileRoute("/documents/$documentId")({ component: DocumentView });

function DocumentView() {
  const { documentId } = Route.useParams();
  const { data: doc, isLoading, error } = useDocument(documentId);

  if (isLoading) return <p className="text-sm text-slate-400">読み込み中…</p>;
  if (error)
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        {error instanceof Error ? error.message : "読み込みに失敗しました"}
      </p>
    );
  if (!doc) return null;

  // key で文書切替時にエディタ内部状態（編集中バッファ）を確実にリセット。
  return <MarkdownEditor key={doc.id} doc={doc} />;
}
