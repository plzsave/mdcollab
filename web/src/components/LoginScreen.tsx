import { useState } from "react";

// 未ログイン時。Google へはフルページ遷移（サーバ側 OIDC フロー）。
export function LoginScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">mdcollab</h1>
        <p className="mt-2 text-sm text-slate-500">
          Markdown 共同編集 + コメント + AI レビュー
        </p>
        <a
          href="/api/auth/login"
          className="mt-6 flex w-full items-center justify-center rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Google でログイン
        </a>

        {import.meta.env.DEV && <DevLogin />}
      </div>
    </div>
  );
}

// ローカル開発専用（vite dev のみ）。バックエンドの DEV_AUTH=1 の dev-login を叩く。
function DevLogin() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    if (!email) return;
    setBusy(true);
    // dev-login は JSON を返してセッション Cookie を発行する。完了後にトップへ。
    await fetch(`/api/auth/dev-login?email=${encodeURIComponent(email)}`, {
      credentials: "include",
    });
    window.location.assign("/");
  };

  return (
    <div className="mt-6 border-t border-dashed border-slate-200 dark:border-slate-700 pt-4">
      <p className="text-xs font-medium text-slate-400">dev ログイン（ローカル専用）</p>
      <div className="mt-2 flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enter()}
          placeholder="you@example.com"
          className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
        />
        <button
          onClick={enter}
          disabled={busy}
          className="rounded-md bg-slate-200 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-300 disabled:opacity-50"
        >
          入る
        </button>
      </div>
    </div>
  );
}
