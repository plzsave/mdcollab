import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// データ層は TanStack Query を主役にするため、Router 側の preload キャッシュは無効化
// （SKILL: router/query の二重キャッシュ回避指針）。
export const router = createRouter({
  routeTree,
  defaultPreloadStaleTime: 0,
});

// 型安全の必須宣言（無いと Link/useNavigate の補完が効かない）。
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
