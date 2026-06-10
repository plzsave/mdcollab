import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// SKILL(router-plugin): tanstackRouter は react() の「前」に置く（逆だと無音で壊れる）。
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    // ローカル開発: /api はホストの Hono(bun run dev, :8787) にプロキシ。
    // 本番は同一 Worker の静的アセットとして配信するためプロキシ不要。
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
