import { afterEach, describe, expect, it, vi } from "vitest";
import { streamReview, type ReviewDone, type ReviewToolEvent } from "./review-stream";
import { ApiError } from "./client";

// 指定したチャンク列を本文に持つ Response を返す fetch をスタブする。
// chunks を分割して enqueue することで「イベントがチャンク境界をまたぐ」状況を再現できる。
function stubFetchStream(chunks: string[], ok = true, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(encoder.encode(ch));
      c.close();
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, status, statusText: "", body } as unknown as Response),
  );
}

// HTTP エラー（body は JSON のエラー形式）を返す fetch をスタブ。
function stubFetchError(status: number, errorBody: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: "Err",
      body: null,
      json: async () => errorBody,
    } as unknown as Response),
  );
}

function collector() {
  const deltas: string[] = [];
  const tools: ReviewToolEvent[] = [];
  let done: ReviewDone | undefined;
  return {
    deltas,
    tools,
    get done() {
      return done;
    },
    handlers: {
      onDelta: (t: string) => deltas.push(t),
      onTool: (t: ReviewToolEvent) => tools.push(t),
      onDone: (m: ReviewDone) => {
        done = m;
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("streamReview", () => {
  it("delta イベントを順に onDelta へ渡し、`data: ` の先頭スペース1個を剥がす", async () => {
    stubFetchStream(["event:delta\ndata: Hello\n\n", "event:delta\ndata: world\n\n"]);
    const c = collector();
    await streamReview("doc1", {}, c.handlers);
    expect(c.deltas).toEqual(["Hello", "world"]);
  });

  it("複数行 data は \\n で結合する", async () => {
    stubFetchStream(["event:delta\ndata: line1\ndata: line2\n\n"]);
    const c = collector();
    await streamReview("doc1", {}, c.handlers);
    expect(c.deltas).toEqual(["line1\nline2"]);
  });

  it("イベントがチャンク境界をまたいでも欠落なく組み立てる", async () => {
    stubFetchStream(["event:delta\ndata: hel", "lo\n\nevent:de", "lta\ndata: !\n\n"]);
    const c = collector();
    await streamReview("doc1", {}, c.handlers);
    expect(c.deltas).toEqual(["hello", "!"]);
  });

  it("tool / done イベントの JSON をパースする", async () => {
    stubFetchStream([
      'event:tool\ndata: {"name":"search_docs","arg":{"q":"x"}}\n\n',
      'event:done\ndata: {"id":"r1","provider":"anthropic","model":"claude","toolsUsed":["search_docs"]}\n\n',
    ]);
    const c = collector();
    await streamReview("doc1", {}, c.handlers);
    expect(c.tools).toEqual([{ name: "search_docs", arg: { q: "x" } }]);
    expect(c.done).toMatchObject({ id: "r1", provider: "anthropic", model: "claude" });
  });

  it("error イベントは ApiError(STREAM_ERROR) を投げる", async () => {
    stubFetchStream(['event:error\ndata: {"message":"boom"}\n\n']);
    const c = collector();
    await expect(streamReview("doc1", {}, c.handlers)).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      code: "STREAM_ERROR",
      message: "boom",
    });
  });

  it("HTTP エラー時はボディの error.code/message を載せた ApiError を投げる", async () => {
    stubFetchError(403, { error: { code: "FORBIDDEN", message: "no access" } });
    const c = collector();
    await expect(streamReview("doc1", {}, c.handlers)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "no access",
    });
  });

  it("repo=true のときは review-repo エンドポイントを叩く", async () => {
    stubFetchStream(["event:done\ndata: {}\n\n"]);
    const c = collector();
    await streamReview("doc9", { repo: true }, c.handlers);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/documents/doc9/review-repo?stream=1");
  });

  it("ApiError は client の ApiError インスタンスである", async () => {
    stubFetchError(500, {});
    await expect(streamReview("d", {}, collector().handlers)).rejects.toBeInstanceOf(ApiError);
  });
});
