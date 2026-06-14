import { defineConfig } from "vitest/config";

// ルート（バックエンド）のテストは test/ 配下のみ。
// web/ は独自の vitest.config.ts（jsdom 環境）を持ち、CI では `cd web && bun run test` で別に走る。
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
