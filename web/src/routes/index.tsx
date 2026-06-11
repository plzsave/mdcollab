import { createFileRoute, Link } from "@tanstack/react-router";
import { useAppState } from "../api/hooks";

export const Route = createFileRoute("/")({ component: Overview });

function Overview() {
  const { data } = useAppState();
  const folders = data?.folders ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">概要</h1>
      <p className="mt-1 text-sm text-slate-500">
        フォルダを選んで文書を開きます。左のサイドバーからも移動できます。
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {folders.map((f) => (
          <Link
            key={f.id}
            to="/folders/$folderId"
            params={{ folderId: f.id }}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 transition hover:border-slate-300 dark:border-slate-600 hover:shadow-sm"
          >
            <div className="font-medium text-slate-800 dark:text-slate-100">{f.name}</div>
            <div className="mt-1 text-xs text-slate-400">作成: {f.createdBy}</div>
          </Link>
        ))}
        {folders.length === 0 && (
          <p className="text-sm text-slate-400">フォルダがまだありません。</p>
        )}
      </div>
    </div>
  );
}
