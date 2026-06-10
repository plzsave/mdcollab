// 未ログイン時。Google へはフルページ遷移（サーバ側 OIDC フロー）。
export function LoginScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-800">mdcollab</h1>
        <p className="mt-2 text-sm text-slate-500">
          Markdown 共同編集 + コメント + AI レビュー
        </p>
        <a
          href="/api/auth/login"
          className="mt-6 flex w-full items-center justify-center rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Google でログイン
        </a>
      </div>
    </div>
  );
}
