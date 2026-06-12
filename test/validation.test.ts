import { describe, it, expect } from "vitest";
import { makeHarness, seedMember, type Harness } from "./helpers/harness";
import * as schema from "../src/db/schema";

// 不正入力でもサーバが 500 で落ちず 400(BAD_REQUEST) で返す＝堅牢性の保証。
// 各ハンドラは JSON parse 失敗を握りつぶして必須項目検査に落とす設計（catch→{}）。

async function member(): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  await h.db
    .insert(schema.documents)
    .values({ id: "d1", title: "Doc", version: 1, createdBy: "u@example.com" });
  return h;
}

// [method, path, 壊れたボディ] の代表セット。期待は一律 400。
const CASES: { name: string; method: string; path: string; body: string }[] = [
  { name: "POST /folders 壊れたJSON", method: "POST", path: "/api/folders", body: "{not json" },
  { name: "POST /folders name 欠落", method: "POST", path: "/api/folders", body: "{}" },
  { name: "POST /documents title 欠落", method: "POST", path: "/api/documents", body: "{}" },
  { name: "PUT /documents/:id content 欠落", method: "PUT", path: "/api/documents/d1", body: "{}" },
  { name: "PATCH /documents/:id 空パッチ", method: "PATCH", path: "/api/documents/d1", body: "{}" },
  {
    name: "POST threads 必須欠落",
    method: "POST",
    path: "/api/documents/d1/threads",
    body: JSON.stringify({ anchorText: "x" }),
  },
  { name: "PUT /ai/settings provider 欠落", method: "PUT", path: "/api/ai/settings", body: "{}" },
];

describe("入力バリデーション: 不正入力は 400（500 にしない）", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const h = await member();
      const res = await h.req(c.path, { as: "u@example.com", method: c.method, body: c.body });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
    });
  }
});
