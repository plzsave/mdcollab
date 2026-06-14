import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// テスト専用設定。vite.config.ts の tanstackRouter プラグイン（routeTree 生成）は
// テストに不要なので読み込まず、React + jsdom だけにする。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
