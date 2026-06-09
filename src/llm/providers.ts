import type { LlmClient, LlmInput } from "./types";

// 実 HTTP の LlmClient（anthropic / openai）。Web 標準 fetch のみ＝Workers/Node/Lambda 共通。
// モデルはユーザー設定値をそのまま使う（ここでハードコードしない）。body は最小限にして
// プロバイダ/モデル間の差（温度パラメータ非対応など）で 400 にならないようにする。

const DEFAULT_MAX_TOKENS = 8192;
const ANTHROPIC_VERSION = "2023-06-01"; // API バージョンヘッダ（モデル版ではない・安定値）

interface Endpoints {
  base: string;
}

function endpointsFor(provider: string): Endpoints {
  switch (provider) {
    case "anthropic":
      return { base: "https://api.anthropic.com" };
    case "openai":
      return { base: "https://api.openai.com" };
    default:
      throw new Error(`unsupported provider: ${provider}`);
  }
}

function authHeaders(provider: string, apiKey: string): Record<string, string> {
  if (provider === "anthropic") {
    return { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION };
  }
  return { authorization: `Bearer ${apiKey}` };
}

function buildBody(input: LlmInput, stream: boolean): unknown {
  if (input.provider === "anthropic") {
    return {
      model: input.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      ...(input.system ? { system: input.system } : {}),
      messages: [{ role: "user", content: input.prompt }],
      ...(stream ? { stream: true } : {}),
    };
  }
  // openai (chat completions)
  const messages = [
    ...(input.system ? [{ role: "system", content: input.system }] : []),
    { role: "user", content: input.prompt },
  ];
  return { model: input.model, messages, ...(stream ? { stream: true } : {}) };
}

function completionPath(provider: string): string {
  return provider === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM ${url} failed: ${res.status} ${text.slice(0, 500)}`);
  }
  return res;
}

// プロバイダ非ストリーミング応答から本文テキストを取り出す。
function extractText(provider: string, json: unknown): string {
  const j = json as Record<string, unknown>;
  if (provider === "anthropic") {
    const blocks = (j.content as { type: string; text?: string }[]) ?? [];
    return blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
  }
  const choices = (j.choices as { message?: { content?: string } }[]) ?? [];
  return choices[0]?.message?.content ?? "";
}

// SSE の1データ行から差分テキストを取り出す（無ければ null）。
function deltaFromSse(provider: string, data: string): string | null {
  if (data === "[DONE]") return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(data);
  } catch {
    return null;
  }
  if (provider === "anthropic") {
    if (obj.type === "content_block_delta") {
      const delta = obj.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === "text_delta") return delta.text ?? null;
    }
    return null;
  }
  const choices = obj.choices as { delta?: { content?: string } }[] | undefined;
  return choices?.[0]?.delta?.content ?? null;
}

async function* parseSse(res: Response, provider: string): AsyncIterable<string> {
  const body = res.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? ""; // 最後の不完全行は次へ持ち越す
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice("data:".length).trim();
      if (!data) continue;
      const text = deltaFromSse(provider, data);
      if (text) yield text;
    }
  }
}

export function createLlmClient(): LlmClient {
  return {
    async complete(input) {
      const { base } = endpointsFor(input.provider);
      const res = await postJson(
        `${base}${completionPath(input.provider)}`,
        authHeaders(input.provider, input.apiKey),
        buildBody(input, false),
      );
      return extractText(input.provider, await res.json());
    },

    async *stream(input) {
      const { base } = endpointsFor(input.provider);
      const res = await postJson(
        `${base}${completionPath(input.provider)}`,
        authHeaders(input.provider, input.apiKey),
        buildBody(input, true),
      );
      yield* parseSse(res, input.provider);
    },

    async listModels(provider, apiKey) {
      const { base } = endpointsFor(provider);
      const res = await fetch(`${base}/v1/models`, {
        headers: authHeaders(provider, apiKey),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`listModels ${provider} failed: ${res.status} ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as { data?: { id: string }[] };
      return (json.data ?? []).map((m) => m.id);
    },
  };
}
