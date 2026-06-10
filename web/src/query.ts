import { QueryClient } from "@tanstack/react-query";

// 401/403 はリトライしない（認証ゲートの分岐に使うため即時にエラーを得たい）。
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});
