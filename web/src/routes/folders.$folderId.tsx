import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAppState, useFolderDocuments } from "../api/hooks";
import { StatusBoard } from "../components/StatusBoard";
import { FolderToolbar } from "../components/FolderToolbar";

export const Route = createFileRoute("/folders/$folderId")({ component: FolderView });

type View = "list" | "board";

function FolderView() {
  const { folderId } = Route.useParams();
  const { data: state } = useAppState();
  const { data: docs, isLoading, error } = useFolderDocuments(folderId);
  const folder = state?.folders.find((f) => f.id === folderId);
  const [view, setView] = useState<View>("list");
  const [showArchived, setShowArchived] = useState(false);

  const statusLabel = (id: string | null) =>
    id ? (state?.statuses.find((s) => s.id === id)?.label ?? id) : null;
  const nameOf = (email: string | null) =>
    email ? (state?.members.find((m) => m.email === email)?.displayName ?? email) : null;

  return (
    <div className={view === "board" ? "mx-auto max-w-full" : "mx-auto max-w-4xl"}>
      <FolderToolbar
        folderId={folderId}
        folderName={folder?.name ?? "フォルダ"}
        docCount={docs?.length ?? 0}
      />

      <div className="mt-3 flex items-center justify-end gap-3">
        {view === "board" && (
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            アーカイブも表示
          </label>
        )}
        <div className="flex overflow-hidden rounded-md border border-slate-200 text-xs">
          {(["list", "board"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 ${
                view === v ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {v === "list" ? "一覧" : "ボード"}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="mt-4 text-sm text-slate-400">読み込み中…</p>}
      {error && (
        <p className="mt-4 text-sm text-red-600">
          {error instanceof Error ? error.message : "読み込みに失敗しました"}
        </p>
      )}

      {view === "board" && docs && state && (
        <StatusBoard
          folderId={folderId}
          docs={docs}
          statuses={state.statuses}
          members={state.members}
          showArchived={showArchived}
        />
      )}

      {view === "list" && (
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
                  {d.assignee && <span>@{nameOf(d.assignee)}</span>}
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
      )}
    </div>
  );
}
