// web_fetch ツールが使う外部取得の抽象（github/llm と同じく Deps に注入）。
// 本番は client.ts の SSRF ガード付き実装、テストは fake を注入＝ネットワーク不要で検証できる。
export interface WebClient {
  /**
   * 外部 URL（https のみ）の内容をテキストで取得する。SSRF ガード・サイズ/タイムアウト上限つき。
   * never throw＝失敗・拒否はメモ文字列を返し、tool_result としてモデルへ渡す。
   */
  fetchUrl(url: string): Promise<string>;
}
