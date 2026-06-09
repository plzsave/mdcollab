// AI プロバイダ呼び出しの抽象（DocumentStore と同じく Deps に注入）。
// 本番は providers.ts の実 HTTP 実装、テストは fake を注入＝ネットワーク不要で検証できる。

export interface LlmInput {
  provider: string; // "anthropic" | "openai" | ...
  model: string;
  apiKey: string;
  system?: string;
  prompt: string;
}

export interface LlmClient {
  /** 非ストリーミング補完。全文を返す。 */
  complete(input: LlmInput): Promise<string>;
  /** ストリーミング補完。チャンク（差分テキスト）を順に yield する。 */
  stream(input: LlmInput): AsyncIterable<string>;
  /** プロバイダのモデル一覧を取得（listAiModels の中継）。 */
  listModels(provider: string, apiKey: string): Promise<string[]>;
}
