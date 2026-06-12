// GitHub クライアント（Deps に注入＝本番は実 HTTP・テストは fake）。
export interface GithubClient {
  /**
   * repo（"owner/name"）の文脈（説明 + README）をプロンプト用テキストとして返す。
   * 取得失敗時も throw せず、説明的なメモ文字列を返す（レビュー自体は続行させる）。
   */
  fetchRepoContext(repo: string, pat: string): Promise<string>;
}
