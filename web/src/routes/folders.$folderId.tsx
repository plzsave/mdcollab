import { createFileRoute, Link } from "@tanstack/react-router";
import { useAppState, useFolderDocuments } from "../api/hooks";

export const Route = createFileRoute("/folders/$folderId")({ component: FolderView });

function FolderView() {
  const { folderId } = Route.useParams();
  const { data: state } = useAppState();
  const { data: docs, isLoading, error } = useFolderDocuments(folderId);
  const folder = state?.folders.find((f) => f.id === folderId);
  const statusLabel = (id: string | null) =>
    id ? (state?.statuses.find((s) => s.id === id)?.label ?? id) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-bold text-slate-800">{folder?.name ?? "フォルダ"}</h1>

      {isLoading && <p className="mt-4 text-sm text-slate-400">読み込み中…</p>}
      {error && (
        <p className="mt-4 text-sm text-red-600">
          {error instanceof Error ? error.message : "読み込みに失敗しました"}
        </p>
      )}

      <ul className="mt-6 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {(docs ?? []).map((d) => (
          <li key={d.id}>
            <Link
              to="/documents/$documentId"
              params={{ documentId: d.id }}
              className="flex items-center justify-between px-4 py-3 transition hover:bg-slate-50"
            >
              <span className="font-medium text-slate-800">{d.title}</span>
              <span className="flex items-center gap-2 text-xs text-slate-400">
                {statusLabel(d.statusId) && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">
                    {statusLabel(d.statusId)}
                  </span>
                )}
                {d.assignee && <span>@{d.assignee}</span>}
                <span>v{d.version}</span>
              </span>
            </Link>
          </li>
        ))}
        {docs?.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-slate-400">
            このフォルダにはまだ文書がありません。
          </li>
        )}
      </ul>
    </div>
  );
}
