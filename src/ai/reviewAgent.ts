import type { LlmClient, ToolDef } from "../llm/types";

// AI レビューのツール使用ループ（ネイティブ tool use・LangChain 不採用）。
// ループ論理はプロバイダ非依存（converse が 1 ターンを正規化済みで返す）＝fake で単体テスト可能。
// tools が空配列なら converse 1 周で終わり、従来の単発レビューと等価に縮退する。

const MAX_TURNS = 6; // ループ打ち切り。超過時は部分結果を保存し truncated:true
const MAX_TOOL_CALLS = 12; // 同一ファイル連続読みなどの暴走抑制

// ツール実体 = ルートが deps/repo/pat を捕捉して組み立てる。
// execute は never throw（エラーはメモ文字列を返す）＝tool_result としてモデルに渡し再試行させる。
export interface ToolImpl {
  def: ToolDef;
  execute(input: unknown): Promise<string>;
}

export interface ReviewAgentEvent {
  type: "delta" | "tool";
  data: string;
}

export interface RunReviewAgentOpts {
  llm: LlmClient;
  provider: string;
  model: string;
  apiKey: string;
  system: string;
  /** 文書＋指示。messages[0]（user）になり、レビュー中ずっと不変＝接頭辞キャッシュの理想形。 */
  initialPrompt: string;
  tools: ToolImpl[];
  onEvent: (e: ReviewAgentEvent) => Promise<void> | void;
}

export interface RunReviewAgentResult {
  text: string;
  toolsUsed: string[];
  truncated: boolean;
}

function describeArg(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (typeof o.path === "string") return o.path;
    if (typeof o.query === "string") return o.query;
    if (Object.keys(o).length === 0) return ""; // 引数なしツール（get_doc_threads / list_repo_tree）
  }
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

export async function runReviewAgent(opts: RunReviewAgentOpts): Promise<RunReviewAgentResult> {
  const registry = new Map(opts.tools.map((t) => [t.def.name, t]));
  // messages[0]: 文書を含む user。cache_control を付けてレビュー中ずっと再送＝キャッシュ読込で都度安くなる。
  let messages: unknown[] = [
    {
      role: "user",
      content: [{ type: "text", text: opts.initialPrompt, cache_control: { type: "ephemeral" } }],
    },
  ];
  let full = "";
  const toolsUsed: string[] = [];
  let calls = 0;
  let completed = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const r = await opts.llm.converse({
      provider: opts.provider,
      model: opts.model,
      apiKey: opts.apiKey,
      system: opts.system,
      messages,
      tools: opts.tools.map((t) => t.def),
      onDelta: (t) => {
        full += t;
        void opts.onEvent({ type: "delta", data: t });
      },
    });

    if (r.toolCalls.length === 0) {
      completed = true;
      break;
    }

    const results: { id: string; content: string }[] = [];
    for (const call of r.toolCalls) {
      if (++calls > MAX_TOOL_CALLS) {
        return { text: full, toolsUsed, truncated: true };
      }
      await opts.onEvent({ type: "tool", data: JSON.stringify({ name: call.name, arg: call.input }) });
      const impl = registry.get(call.name);
      const out = impl ? await impl.execute(call.input) : `unknown tool: ${call.name}`;
      toolsUsed.push(`${call.name}:${describeArg(call.input)}`);
      results.push({ id: call.id, content: out });
    }

    // rawAssistant（tool_use ブロックを含む生）をそのまま積み、tool_result で応答する。
    // 正規化結果から会話を再構築しないのが tool_use_id 対応の正しさの鍵。
    messages = [
      ...messages,
      r.rawAssistant,
      {
        role: "user",
        content: results.map((res) => ({ type: "tool_result", tool_use_id: res.id, content: res.content })),
      },
    ];
  }

  // 正常完了（completed）以外＝MAX_TURNS 到達でまだツールを要求中＝部分結果として truncated:true（§10/§13）。
  return { text: full, toolsUsed, truncated: !completed };
}
