import { Link } from "@tanstack/react-router";
import { useUpdateDocumentMeta } from "../api/hooks";
import type { DocumentMeta, Member, Status } from "../api/types";

const UNSET = "__unset__";

// フォルダ内文書をステータス列で並べるボード。DnD は使わず、カードのセレクトで
// ステータス移動・担当割当を行う（PATCH /api/documents/:id）。
export function StatusBoard({
  folderId,
  docs,
  statuses,
  members,
  showArchived,
}: {
  folderId: string;
  docs: DocumentMeta[];
  statuses: Status[];
  members: Member[];
  showArchived: boolean;
}) {
  const update = useUpdateDocumentMeta(folderId);

  const visible = docs.filter((d) => showArchived || !d.archived);
  const sortedStatuses = statuses.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  // 列: 未設定 + 各ステータス。
  const columns: { key: string; label: string; statusId: string | null }[] = [
    { key: UNSET, label: "未設定", statusId: null },
    ...sortedStatuses.map((s) => ({ key: s.id, label: s.label, statusId: s.id })),
  ];
  const docsIn = (statusId: string | null) =>
    visible.filter((d) => (d.statusId ?? null) === statusId);

  return (
    <div className="mt-6 flex gap-3 overflow-x-auto pb-4">
      {columns.map((col) => {
        const items = docsIn(col.statusId);
        return (
          <div key={col.key} className="flex w-64 shrink-0 flex-col rounded-lg bg-slate-100/70 p-2">
            <div className="flex items-center justify-between px-1 py-1">
              <span className="text-xs font-semibold text-slate-600">{col.label}</span>
              <span className="text-xs text-slate-400">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((d) => (
                <BoardCard
                  key={d.id}
                  doc={d}
                  statuses={sortedStatuses}
                  members={members}
                  pending={update.isPending}
                  onChange={(patch) => update.mutate({ id: d.id, ...patch })}
                />
              ))}
              {items.length === 0 && (
                <p className="px-1 py-2 text-center text-[11px] text-slate-400">（なし）</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({
  doc,
  statuses,
  members,
  pending,
  onChange,
}: {
  doc: DocumentMeta;
  statuses: Status[];
  members: Member[];
  pending: boolean;
  onChange: (patch: { statusId?: string | null; assignee?: string | null; archived?: boolean }) => void;
}) {
  return (
    <div
      className={`rounded-md border border-slate-200 bg-white p-2.5 shadow-sm ${
        doc.archived ? "opacity-60" : ""
      }`}
    >
      <Link
        to="/documents/$documentId"
        params={{ documentId: doc.id }}
        className="block text-sm font-medium text-slate-800 hover:text-slate-600"
      >
        {doc.title}
      </Link>
      <div className="mt-1 text-[10px] text-slate-400">v{doc.version}</div>

      <div className="mt-2 space-y-1.5">
        <select
          value={doc.statusId ?? UNSET}
          disabled={pending}
          onChange={(e) =>
            onChange({ statusId: e.target.value === UNSET ? null : e.target.value })
          }
          className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600 focus:border-slate-400 focus:outline-none"
        >
          <option value={UNSET}>未設定</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          value={doc.assignee ?? UNSET}
          disabled={pending}
          onChange={(e) =>
            onChange({ assignee: e.target.value === UNSET ? null : e.target.value })
          }
          className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600 focus:border-slate-400 focus:outline-none"
        >
          <option value={UNSET}>担当なし</option>
          {members.map((m) => (
            <option key={m.email} value={m.email}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-1.5 text-right">
        <button
          onClick={() => onChange({ archived: !doc.archived })}
          disabled={pending}
          className="text-[10px] text-slate-400 hover:text-slate-700"
        >
          {doc.archived ? "復元" : "アーカイブ"}
        </button>
      </div>
    </div>
  );
}
