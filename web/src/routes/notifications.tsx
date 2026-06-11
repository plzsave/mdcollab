import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "../api/hooks";
import type { Notification } from "../api/types";

export const Route = createFileRoute("/notifications")({ component: NotificationsView });

const TYPE_LABEL: Record<string, string> = {
  mention: "メンション",
  reply: "返信",
  resolve: "解決",
};

function NotificationsView() {
  const { data: notes, isLoading, error } = useNotifications();
  const markAll = useMarkAllNotificationsRead();

  const unread = (notes ?? []).filter((n) => !n.isRead).length;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">
          通知{unread > 0 && <span className="ml-2 text-sm font-normal text-amber-600">未読 {unread}</span>}
        </h1>
        <button
          onClick={() => markAll.mutate()}
          disabled={unread === 0 || markAll.isPending}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          すべて既読
        </button>
      </div>

      {isLoading && <p className="mt-4 text-sm text-slate-400">読み込み中…</p>}
      {error && (
        <p className="mt-4 text-sm text-red-600">
          {error instanceof Error ? error.message : "読み込みに失敗しました"}
        </p>
      )}

      <ul className="mt-6 space-y-2">
        {(notes ?? []).map((n) => (
          <NotificationItem key={n.id} note={n} />
        ))}
        {notes?.length === 0 && (
          <li className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
            通知はありません。
          </li>
        )}
      </ul>
    </div>
  );
}

function NotificationItem({ note }: { note: Notification }) {
  const markRead = useMarkNotificationRead();

  const body = (
    <div
      className={`rounded-lg border px-4 py-3 ${
        note.isRead ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs">
          <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
            {TYPE_LABEL[note.type] ?? note.type}
          </span>
          {note.documentName && <span className="text-slate-500">{note.documentName}</span>}
          {!note.isRead && <span className="h-2 w-2 rounded-full bg-amber-500" />}
        </span>
        <span className="text-[11px] text-slate-400">{fmtTime(note.createdAt)}</span>
      </div>
      {note.message && <p className="mt-1 text-sm text-slate-700">{note.message}</p>}
    </div>
  );

  // 文書つき通知はクリックで該当文書へ。開く際に既読化する。
  if (note.documentId) {
    return (
      <li>
        <Link
          to="/documents/$documentId"
          params={{ documentId: note.documentId }}
          onClick={() => {
            if (!note.isRead) markRead.mutate(note.id);
          }}
          className="block transition hover:opacity-90"
        >
          {body}
        </Link>
      </li>
    );
  }

  return (
    <li>
      {body}
      {!note.isRead && (
        <button
          onClick={() => markRead.mutate(note.id)}
          className="mt-1 text-[11px] text-slate-400 hover:text-slate-700"
        >
          既読にする
        </button>
      )}
    </li>
  );
}

function fmtTime(s: string): string {
  return new Date(s).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
