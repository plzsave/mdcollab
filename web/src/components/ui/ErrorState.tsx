import { IconAlert } from "../icons";

// 全画面エラー表示（#20）。素の赤文字の代わりに、ブランディング + 再試行/ログイン導線を出す。
// バックエンド不通（Bad Gateway 等）でトップが真っ白／赤文字だけになるのを防ぐ。
export function FullScreenError({
  message,
  onRetry,
  showLogin = false,
}: {
  message: string;
  onRetry?: () => void;
  showLogin?: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">mdcollab</h1>
        <div className="mt-5 flex justify-center text-red-500" aria-hidden="true">
          <IconAlert width={32} height={32} />
        </div>
        <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
          接続できませんでした
        </p>
        <p className="mt-1 break-words text-xs text-slate-400 dark:text-slate-500">{message}</p>
        <div className="mt-6 flex flex-col gap-2">
          {onRetry && (
            <button
              onClick={onRetry}
              className="w-full rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              再試行
            </button>
          )}
          {showLogin && (
            <a
              href="/api/auth/login"
              className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              ログインし直す
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
