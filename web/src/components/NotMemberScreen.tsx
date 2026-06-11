import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import { useLogout } from "../api/hooks";

// ログイン済みだが members に居ない（403）。初回はセットアップで自分を owner 化できる。
export function NotMemberScreen() {
  const qc = useQueryClient();
  const logout = useLogout();
  const setup = useMutation({
    mutationFn: () => api.post<{ ok: boolean; bootstrapped: boolean }>("/api/setup"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["state"] }),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">アクセス権がありません</h1>
        <p className="mt-2 text-sm text-slate-500">
          このアカウントはまだメンバーに登録されていません。初回起動の場合は、下のボタンで
          自分を owner として初期セットアップできます。すでに運用中なら、owner に追加を依頼してください。
        </p>

        {setup.error instanceof ApiError && (
          <p className="mt-4 rounded-md bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {setup.error.status === 403
              ? "すでにメンバーが存在するため、セットアップはできません。owner に追加を依頼してください。"
              : setup.error.message}
          </p>
        )}

        <button
          onClick={() => setup.mutate()}
          disabled={setup.isPending}
          className="mt-6 w-full rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {setup.isPending ? "セットアップ中…" : "初回セットアップ（自分を owner にする）"}
        </button>

        <button
          onClick={() => logout.mutate()}
          className="mt-3 block w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:text-slate-300"
        >
          別のアカウントでログインし直す
        </button>
      </div>
    </div>
  );
}
