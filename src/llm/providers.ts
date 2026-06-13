import type { ConverseInput, LlmClient, LlmInput, LlmTurnResult, ToolDef } from "./types";

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

// SSE を「行」ではなく「パース済みイベントオブジェクト」として列挙する
// （converse は text_delta だけでなく tool_use ブロックや index も見る必要がある）。
async function* parseSseEvents(res: Response): AsyncIterable<Record<string, unknown>> {
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
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice("data:".length).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as Record<string, unknown>;
      } catch {
        /* 不完全/非 JSON 行は無視 */
      }
    }
  }
}

function toAnthropicTool(t: ToolDef): unknown {
  return { name: t.name, description: t.description, input_schema: t.inputSchema };
}

// raw（anthropic ブロック形）messages を openai/プレーン用の素テキストへ畳む。
// 非 anthropic 経路は tool 非対応＝単発に縮退するので messages は user 1件のみ。
function toPlainMessages(system: string | undefined, messages: unknown[]): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages as { role?: string; content?: unknown }[]) {
    const content = Array.isArray(m.content)
      ? (m.content as { type?: string; text?: string }[])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("")
      : String(m.content ?? "");
    out.push({ role: m.role ?? "user", content });
  }
  return out;
}

// Anthropic の tool use ストリーミングを 1 ターン分消費して LlmTurnResult に正規化する。
// content_block_start で tool_use/text を index ごとに開始し、content_block_delta で
// text_delta（→onDelta）/ input_json_delta（→部分JSON蓄積）を積み、終端で確定する。
async function anthropicConverse(base: string, input: ConverseInput): Promise<LlmTurnResult> {
  const body = {
    model: input.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    stream: true,
    // breakpoint 1: system（tools は system より前に描画されるので tools+system がまとめてキャッシュされる）
    ...(input.system
      ? { system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }] }
      : {}),
    ...(input.tools.length ? { tools: input.tools.map(toAnthropicTool) } : {}),
    messages: input.messages, // breakpoint 2 は loop が messages[0] に付与済み
  };
  const res = await postJson(`${base}/v1/messages`, authHeaders("anthropic", input.apiKey), body);

  type Block = { type: string; text?: string; id?: string; name?: string; partialJson?: string };
  const blocks: Block[] = [];
  let text = "";

  for await (const ev of parseSseEvents(res)) {
    if (ev.type === "content_block_start") {
      const idx = ev.index as number;
      const cb = ev.content_block as { type: string; id?: string; name?: string };
      if (cb.type === "tool_use") {
        blocks[idx] = { type: "tool_use", id: cb.id, name: cb.name, partialJson: "" };
      } else {
        blocks[idx] = { type: cb.type, text: "" };
      }
    } else if (ev.type === "content_block_delta") {
      const idx = ev.index as number;
      const delta = ev.delta as { type?: string; text?: string; partial_json?: string };
      const b = blocks[idx];
      if (!b) continue;
      if (delta.type === "text_delta") {
        b.text = (b.text ?? "") + (delta.text ?? "");
        text += delta.text ?? "";
        input.onDelta?.(delta.text ?? "");
      } else if (delta.type === "input_json_delta") {
        b.partialJson = (b.partialJson ?? "") + (delta.partial_json ?? "");
      }
    }
    // content_block_stop / message_delta / message_stop は蓄積で足りるため無視
  }

  const rawContent: unknown[] = [];
  const toolCalls: LlmTurnResult["toolCalls"] = [];
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === "tool_use") {
      let parsed: unknown = {};
      const pj = (b.partialJson ?? "").trim();
      if (pj) {
        try {
          parsed = JSON.parse(pj);
        } catch {
          parsed = {};
        }
      }
      rawContent.push({ type: "tool_use", id: b.id, name: b.name, input: parsed });
      toolCalls.push({ id: b.id!, name: b.name!, input: parsed });
    } else if (b.type === "text") {
      rawContent.push({ type: "text", text: b.text ?? "" });
    }
  }
  return { text, toolCalls, rawAssistant: { role: "assistant", content: rawContent } };
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

    async converse(input) {
      const { base } = endpointsFor(input.provider);
      if (input.provider === "anthropic") {
        return anthropicConverse(base, input);
      }
      // Phase A: 非 anthropic は tool use 未対応＝単発テキストに縮退（tools は無視）。
      // openai chat completions をストリーミングし、text を蓄積する。
      const res = await postJson(`${base}${completionPath(input.provider)}`, authHeaders(input.provider, input.apiKey), {
        model: input.model,
        messages: toPlainMessages(input.system, input.messages),
        stream: true,
      });
      let text = "";
      for await (const chunk of parseSse(res, input.provider)) {
        text += chunk;
        input.onDelta?.(chunk);
      }
      return { text, toolCalls: [], rawAssistant: null };
    },
  };
}
