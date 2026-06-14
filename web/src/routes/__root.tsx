import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useAppState } from "../api/hooks";
import { ApiError } from "../api/client";
import { LoginScreen } from "../components/LoginScreen";
import { NotMemberScreen } from "../components/NotMemberScreen";
import { AppShell } from "../components/AppShell";
import { FullScreenError } from "../components/ui/ErrorState";

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  const { data, isLoading, error, refetch } = useAppState();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 text-sm text-slate-400">
        読み込み中…
      </div>
    );
  }

  if (error) {
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 401) return <LoginScreen />;
    if (status === 403) return <NotMemberScreen />;
    // バックエンド不通やサーバエラー: ブランディング + 再試行で復帰可能にする。
    return (
      <FullScreenError
        message={error instanceof Error ? error.message : "不明なエラー"}
        onRetry={() => refetch()}
        showLogin
      />
    );
  }

  return (
    <AppShell state={data!}>
      <Outlet />
    </AppShell>
  );
}
