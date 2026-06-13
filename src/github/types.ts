// GitHub クライアント（Deps に注入＝本番は実 HTTP・テストは fake）。
export interface GithubClient {
  /**
   * repo（"owner/name"）の文脈（説明 + README）をプロンプト用テキストとして返す。
   * 取得失敗時も throw せず、説明的なメモ文字列を返す（レビュー自体は続行させる）。
   */
  fetchRepoContext(repo: string, pat: string): Promise<string>;

  /**
   * repo（"owner/name"）内の単一ファイルをテキストで返す（tool use の fetch_repo_file 用）。
   * fetchRepoContext と同じく throw せず、エラー時は説明的なメモ文字列を返す（モデルに再試行/断念させる）。
   * path 検証・サイズ上限は実装側の責務。
   */
  fetchRepoFile(repo: string, path: string, pat: string): Promise<string>;
}
