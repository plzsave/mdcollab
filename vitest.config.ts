import { defineConfig } from "vitest/config";

// ルート（バックエンド）のテストは test/ 配下のみ。
// web/ は独自の vitest.config.ts（jsdom 環境）を持ち、CI では `cd web && bun run test` で別に走る。
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 各テストは makeTestDb() で pglite（WASM Postgres）を新規起動し全 migration を適用する。
    // 各ファイル先頭テストは WASM コールド起動分を負担し、CI の共有ランナーでは
    // 既定 5000ms を越えてフレークする（ローカルは ~1s）。コールド起動を見込んで余裕を持たせる。
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
