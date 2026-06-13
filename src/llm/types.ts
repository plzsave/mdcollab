// AI プロバイダ呼び出しの抽象（DocumentStore と同じく Deps に注入）。
// 本番は providers.ts の実 HTTP 実装、テストは fake を注入＝ネットワーク不要で検証できる。

export interface LlmInput {
  provider: string; // "anthropic" | "openai" | ...
  model: string;
  apiKey: string;
  system?: string;
  prompt: string;
}

// ツール定義（プロバイダ非依存の正規形）。description は「いつ呼ぶか」を明記する（公式推奨）。
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

// 1ターン（1往復）の正規化結果。プロバイダのワイヤ形式
// （anthropic content blocks / openai tool_calls）を吸収する。
export interface LlmTurnResult {
  /** このターンで生成された assistant テキスト（全文）。 */
  text: string;
  /** モデルが要求したツール呼び出し。空配列＝このターンで完了。 */
  toolCalls: { id: string; name: string; input: unknown }[];
  /**
   * 次ターンへ append し戻す「生」の assistant ブロック（正しさ＆キャッシュ用）。
   * 正規化結果から会話を再構築せず、これをそのまま積むことで tool_use_id の対応が壊れない。
   * 非 anthropic 経路など tool 非対応時は null。
   */
  rawAssistant: unknown;
}

export interface ConverseInput {
  provider: string;
  model: string;
  apiKey: string;
  system?: string;
  /** 蓄積した会話（tool_result 含む）。生ブロックを持ち回る（プロバイダ差を providers.ts に閉じ込める）。 */
  messages: unknown[];
  tools: ToolDef[];
  /** 最終ターンのトークン流し用。text_delta を逐次コールする。 */
  onDelta?: (text: string) => void;
}

export interface LlmClient {
  /** 非ストリーミング補完。全文を返す。 */
  complete(input: LlmInput): Promise<string>;
  /** ストリーミング補完。チャンク（差分テキスト）を順に yield する。 */
  stream(input: LlmInput): AsyncIterable<string>;
  /** プロバイダのモデル一覧を取得（listAiModels の中継）。 */
  listModels(provider: string, apiKey: string): Promise<string[]>;
  /**
   * 1ターンだけ実行して正規化結果を返す（tool use ループの 1 周分）。
   * 内部は常に stream:true で、text_delta を onDelta へ逐次コールする。
   */
  converse(input: ConverseInput): Promise<LlmTurnResult>;
}
