import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./client";

function stubFetch(res: Partial<Response> & { json?: () => Promise<unknown> }) {
  const mock = vi.fn().mockResolvedValue(res as Response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("api client request", () => {
  it("成功レスポンスの JSON を返す", async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ hello: "world" }) });
    await expect(api.get<{ hello: string }>("/x")).resolves.toEqual({ hello: "world" });
  });

  it("204 No Content は undefined を返す（json を呼ばない）", async () => {
    const json = vi.fn();
    stubFetch({ ok: true, status: 204, json });
    await expect(api.delete("/x")).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it("409 のボディ全体を ApiError.data に保持する（楽観ロックの current 取得用）", async () => {
    stubFetch({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ error: { code: "CONFLICT", message: "version mismatch" }, current: 7 }),
    });
    const err = (await api.put("/doc", {}).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("CONFLICT");
    expect((err.data as { current: number }).current).toBe(7);
  });

  it("非 JSON のエラーボディは statusText にフォールバックする", async () => {
    stubFetch({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new Error("not json");
      },
    });
    const err = (await api.get("/x").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("ERROR");
    expect(err.message).toBe("Internal Server Error");
  });

  it("put は If-Match などの追加ヘッダを送る", async () => {
    const mock = stubFetch({ ok: true, status: 200, json: async () => ({}) });
    await api.put("/doc", { content: "x" }, { "If-Match": "3" });
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe("3");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ content: "x" }));
  });
});
