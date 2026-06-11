import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useLogout } from "../api/hooks";
import type { AppState } from "../api/types";

// ログイン済みメンバーの共通レイアウト（左サイドバー: フォルダ一覧 + 上部バー）。
export function AppShell({ state, children }: { state: AppState; children: ReactNode }) {
  const logout = useLogout();
  const unread = state.notifications.filter((n) => !n.isRead).length;

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4">
          <Link to="/" className="text-lg font-bold text-slate-800">
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
                  className="block rounded-md px-2 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 [&.active]:bg-slate-100 [&.active]:font-medium [&.active]:text-slate-900"
                >
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-0.5 border-t border-slate-200 px-2 py-2">
          <Link
            to="/notifications"
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 [&.active]:bg-slate-100 [&.active]:font-medium [&.active]:text-slate-900"
          >
            <span>🔔 通知</span>
            {unread > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-700">
                {unread}
              </span>
            )}
          </Link>
          <Link
            to="/members"
            className="block rounded-md px-2 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 [&.active]:bg-slate-100 [&.active]:font-medium [&.active]:text-slate-900"
          >
            👥 メンバー
          </Link>
          <Link
            to="/settings/ai"
            className="block rounded-md px-2 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 [&.active]:bg-slate-100 [&.active]:font-medium [&.active]:text-slate-900"
          >
            ⚙ AI 設定
          </Link>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="text-sm text-slate-400">
            {unread > 0 && (
              <Link
                to="/notifications"
                className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-200"
              >
                通知 {unread}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">{state.currentUser.email}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {state.currentUser.role}
            </span>
            <button
              onClick={() => logout.mutate()}
              className="text-xs text-slate-400 hover:text-slate-700"
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
