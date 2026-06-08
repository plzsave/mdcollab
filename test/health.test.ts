import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";
import type { Deps } from "../src/env";

// DB/ストアに触れない /health の最小スモークテスト。
// ランタイム非依存に書く＝1スイートで Workers/Lambda 両対応（§5.2）。
const deps = {
  db: {} as Deps["db"],
  store: {} as Deps["store"],
  config: {
    baseUrl: "http://localhost",
    sessionSecret: "test-secret",
    google: { clientId: "x", clientSecret: "x" },
  },
} satisfies Deps;

describe("health", () => {
  it("returns ok", async () => {
    const app = createApp(deps);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
