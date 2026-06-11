import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useCreateFolder, useLogout } from "../api/hooks";
import { ApiError } from "../api/client";
import { ThemeToggle } from "./ThemeToggle";
import type { AppState } from "../api/types";

// ログイン済みメンバーの共通レイアウト（左サイドバー: フォルダ一覧 + 上部バー）。
export function AppShell({ state, children }: { state: AppState; children: ReactNode }) {
  const logout = useLogout();
  const unread = state.notifications.filter((n) => !n.isRead).length;
  // ユーザー表示は原則「表示名」に統一（メールはツールチップ）。
  const me = state.members.find((m) => m.email === state.currentUser.email);
  const myName = me?.displayName ?? state.currentUser.name ?? state.currentUser.email;

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      <aside className="flex w-64 flex-col border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-4">
          <Link to="/" className="text-lg font-bold text-slate-800 dark:text-slate-100">
            mdcollab
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            フォルダ
          </div>
          {state.folders.length === 0 && (
            <p className="px-2 py-1 text-sm text-slate-400">（まだありません）</p>
          )}
          <ul className="space-y-0.5">
            {state.folders.map((f) => (
              <li key={f.id}>
                <Link
                  to="/folders/$folderId"
                  params={{ folderId: f.id }}
                  className="block rounded-md px-2 py-1.5 text-sm text-slate-600 dark:text-slate-300 transition hover:bg-slate-100 dark:hover:bg-slate-700 [&.active]:bg-slate-100 [&.active]:font-medium [&.active]:text-slate-900"
                >
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
          <NewFolderForm />
        </nav>

        <div className="space-y-0.5 border-t border-slate-200 dark:border-slate-700 px-2 py-2">
          <Link
            to="/notifications"
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-slate-600 dark:text-slate-300 transition hover:bg-slate-100 dark:hover:bg-slate-700 [&.active]:bg-slate-100 [&.active]:font-medium [&.active]:text-slate-900"
          >
            <span>🔔 通知</span>
            {unread > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                {unread}
              </span>
            )}
          </Link>
          <Link
            to="/members"
            className="block rounded-md px-2 py-1.5 text-sm text-slate-600 dark:text-slate-300 transition hover:bg-slate-100 dark:hover:bg-slate-700 [&.active]:bg-slate-100 [&.active]:font-medium [&.active]:text-slate-900"
          >
            👥 メンバー
          </Link>
          <Link
            to="/settings/ai"
            className="block rounded-md px-2 py-1.5 text-sm text-slate-600 dark:text-slate-300 transition hover:bg-slate-100 dark:hover:bg-slate-700 [&.active]:bg-slate-100 [&.active]:font-medium [&.active]:text-slate-900"
          >
            ⚙ AI 設定
          </Link>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-3">
          <div className="text-sm text-slate-400">
            {unread > 0 && (
              <Link
                to="/notifications"
                className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-200"
              >
                通知 {unread}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <ThemeToggle />
            <span className="text-slate-700 dark:text-slate-200" title={state.currentUser.email}>
              {myName}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {state.currentUser.role}
            </span>
            <button
              onClick={() => logout.mutate()}
              className="text-xs text-slate-400 hover:text-slate-700 dark:text-slate-200"
            >
              ログアウト
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

// サイドバーのフォルダ作成（インライン・成功で入力クリア）。
function NewFolderForm() {
  const create = useCreateFolder();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(name.trim(), {
      onSuccess: () => {
        setName("");
        setOpen(false);
      },
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:text-slate-300"
      >
        ＋ 新規フォルダ
      </button>
    );
  }

  return (
    <div className="mt-1 px-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="フォルダ名"
        className="w-full rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm focus:border-slate-400 focus:outline-none"
      />
      {create.error && (
        <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
          {create.error instanceof ApiError ? create.error.message : "作成に失敗しました"}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <button
          onClick={() => setOpen(false)}
          className="text-[11px] text-slate-400 hover:text-slate-700 dark:text-slate-200"
        >
          取消
        </button>
        <button
          onClick={submit}
          disabled={!name.trim() || create.isPending}
          className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-white hover:bg-slate-700 disabled:opacity-40"
        >
          作成
        </button>
      </div>
    </div>
  );
}
