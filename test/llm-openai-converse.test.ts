import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLlmClient } from "../src/llm/providers";
import type { ConverseInput, ToolDef } from "../src/llm/types";

// OpenAI converse のパリティ（Phase C）をネットワークなしで検証する。
// global.fetch を差し替えて OpenAI の chat completions SSE を返し、
// (1) tool_calls の index 分割蓄積 → 正規化、(2) テキスト delta、(3) 正準 IR→OpenAI ワイヤ翻訳 を確認する。

const FETCH_TOOL: ToolDef = {
  name: "fetch_repo_file",
  description: "ファイル取得",
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

// OpenAI SSE レスポンス（data: {...}\n\n ... data: [DONE]）を組み立てる。
function sse(...objs: unknown[]): Response {
  const text = objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const origFetch = globalThis.fetch;
let lastUrl = "";
let lastBody: Record<string, unknown> = {};
let nextResponse: () => Response = () => sse();

beforeEach(() => {
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    lastUrl = String(url);
    lastBody = JSON.parse((init as { body: string }).body);
    return nextResponse();
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

function input(overrides: Partial<ConverseInput>): ConverseInput {
  return {
    provider: "openai",
    model: "gpt-x",
    apiKey: "sk-test",
    messages: [{ role: "user", content: [{ type: "text", text: "doc" }] }],
    tools: [],
    ...overrides,
  };
}

describe("OpenAI converse パリティ", () => {
  it("tool_calls を index ごとに蓄積し正準 IR へ正規化する", async () => {
    // id/name と arguments が別 delta に分割されて届くケース
    nextResponse = () =>
      sse(
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "fetch_repo_file", arguments: "" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"src/x.ts"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      );

    const r = await createLlmClient().converse(input({ tools: [FETCH_TOOL] }));

    expect(lastUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(r.text).toBe("");
    expect(r.toolCalls).toEqual([{ id: "call_1", name: "fetch_repo_file", input: { path: "src/x.ts" } }]);
    // rawAssistant は正準 IR（anthropic ブロック形）＝次ターンに積み戻せる
    expect(r.rawAssistant).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "call_1", name: "fetch_repo_file", input: { path: "src/x.ts" } }],
    });
    // tools は OpenAI function 形式へ翻訳されて送られる
    expect((lastBody.tools as { type: string; function: { name: string } }[])[0]).toMatchObject({
      type: "function",
      function: { name: "fetch_repo_file" },
    });
  });

  it("テキスト delta を蓄積し onDelta へ流す（tool なしで完了）", async () => {
    nextResponse = () =>
      sse(
        { choices: [{ delta: { content: "指摘" } }] },
        { choices: [{ delta: { content: "です" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      );

    const deltas: string[] = [];
    const r = await createLlmClient().converse(input({ onDelta: (t) => deltas.push(t) }));

    expect(r.text).toBe("指摘です");
    expect(r.toolCalls).toEqual([]);
    expect(deltas).toEqual(["指摘", "です"]);
  });

  it("最終 usage チャンクを正規化する（include_usage 要求・cached は input から差し引く）", async () => {
    nextResponse = () =>
      sse(
        { choices: [{ delta: { content: "ok" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
        // OpenAI は usage チャンクを choices 空で最後に送る
        {
          choices: [],
          usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 800 } },
        },
      );

    const r = await createLlmClient().converse(input({}));

    // stream_options.include_usage を要求している
    expect(lastBody.stream_options).toEqual({ include_usage: true });
    // prompt_tokens(1000) は cached(800) を含むので、新規入力は 200・キャッシュ読込 800 に分解
    expect(r.usage).toEqual({
      inputTokens: 200,
      outputTokens: 200,
      cacheReadInputTokens: 800,
      cacheCreationInputTokens: 0,
    });
  });

  it("正準 IR を OpenAI ワイヤ形式へ翻訳する（tool_use→tool_calls、tool_result→role:tool）", async () => {
    nextResponse = () => sse({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] });

    await createLlmClient().converse(
      input({
        system: "SYS",
        messages: [
          { role: "user", content: [{ type: "text", text: "doc 本文" }] },
          { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "fetch_repo_file", input: { path: "a.ts" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "FILE BODY" }] },
        ],
      }),
    );

    const msgs = lastBody.messages as { role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }[];
    expect(msgs[0]).toEqual({ role: "system", content: "SYS" });
    expect(msgs[1]).toEqual({ role: "user", content: "doc 本文" });
    // assistant の tool_use → tool_calls(function, arguments は JSON 文字列)
    expect(msgs[2]).toMatchObject({
      role: "assistant",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "fetch_repo_file", arguments: '{"path":"a.ts"}' } }],
    });
    // tool_result → role:"tool"（tool_call_id で対応）
    expect(msgs[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "FILE BODY" });
  });
});
