import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAppState, useFolderDocuments } from "../api/hooks";
import { StatusBoard } from "../components/StatusBoard";
import { FolderToolbar } from "../components/FolderToolbar";
import { statusBadgeClass, statusDotClass } from "../lib/statusColor";
import type { DocumentMeta, Status } from "../api/types";

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
        <div className="flex overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 text-xs">
          {(["list", "board"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 ${
                view === v ? "bg-slate-800 dark:bg-slate-700 text-white" : "bg-white dark:bg-slate-900 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              {v === "list" ? "一覧" : "ボード"}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="mt-4 text-sm text-slate-400">読み込み中…</p>}
      {error && (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
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
        <>
          {docs && docs.length > 0 && state && (
            <StatusSummary docs={docs} statuses={state.statuses} />
          )}
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {(docs ?? []).map((d) => (
              <li key={d.id}>
                <Link
                  to="/documents/$documentId"
                  params={{ documentId: d.id }}
                  className="flex items-center justify-between px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800 dark:hover:bg-slate-800"
                >
                  <span className="font-medium text-slate-800 dark:text-slate-100 dark:text-slate-100">{d.title}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-400">
                    <span
                      className={`rounded px-2 py-0.5 ${statusBadgeClass(d.statusId, state?.statuses ?? [])}`}
                    >
                      {statusLabel(d.statusId) ?? "未設定"}
                    </span>
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
        </>
      )}
    </div>
  );
}

// 一覧上部のステータス別カウント（未設定含む）。ボードに切り替えずに進捗が分かる。
function StatusSummary({ docs, statuses }: { docs: DocumentMeta[]; statuses: Status[] }) {
  const active = docs.filter((d) => !d.archived);
  const sorted = [...statuses].sort((a, b) => a.sortOrder - b.sortOrder);
  const countOf = (statusId: string | null) =>
    active.filter((d) => (d.statusId ?? null) === statusId).length;
  const unset = countOf(null);

  const cells = [
    ...sorted.map((s) => ({ key: s.id, label: s.label, count: countOf(s.id), statusId: s.id })),
    ...(unset > 0 ? [{ key: "__unset__", label: "未設定", count: unset, statusId: null }] : []),
  ];

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900">
      <span className="text-xs font-semibold text-slate-400">進捗</span>
      {cells.map((c) => (
        <span key={c.key} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(c.statusId, statuses)}`} />
          <span className="text-slate-600 dark:text-slate-300 dark:text-slate-300">{c.label}</span>
          <span className="font-semibold text-slate-800 dark:text-slate-100 dark:text-slate-100">{c.count}</span>
        </span>
      ))}
      <span className="ml-auto text-xs text-slate-400">計 {active.length} 件</span>
    </div>
  );
}
