// GitHub クライアント（Deps に注入＝本番は実 HTTP・テストは fake）。
export interface GithubClient {
  /**
   * repo（"owner/name"）の文脈（説明 + README）をプロンプト用テキストとして返す。
   * 取得失敗時も throw せず、説明的なメモ文字列を返す（レビュー自体は続行させる）。
   */
  fetchRepoContext(repo: string, pat: string): Promise<string>;

  /**
   * repo（"owner/name"）内の単一ファイルをテキストで返す（tool use の fetch_repo_file 用）。
   * startLine/endLine（1 始まり）で行範囲を指定すると該当行だけを行番号付きで返す（トークン節約・#82）。
   * fetchRepoContext と同じく throw せず、エラー時は説明的なメモ文字列を返す（モデルに再試行/断念させる）。
   * path 検証・サイズ上限は実装側の責務。
   */
  fetchRepoFile(
    repo: string,
    path: string,
    pat: string,
    startLine?: number,
    endLine?: number,
  ): Promise<string>;

  /**
   * repo（"owner/name"）のファイルツリー（blob パス一覧）をテキストで返す（list_repo_tree 用）。
   * default ブランチを解決して git/trees を recursive 取得する。subdir 指定でその配下に絞り、
   * 未指定の大規模リポ（モノレポ）はトップ階層＋manifest の概要を返す（#82）。fetchRepoFile 同様
   * throw せず、エラー時は説明的なメモ文字列を返す。件数上限は実装側の責務。
   */
  listRepoTree(repo: string, pat: string, subdir?: string): Promise<string>;

  /**
   * repo（"owner/name"）内のコードをキーワード検索し、path:line の一致一覧を返す
   * （search_repo_code 用・#82）。GitHub の /search/code には依存しない自前 grep
   * （fine-grained PAT で静かに 0 件になる・インデックス欠落の回避）。path 指定で
   * 検索範囲をサブディレクトリに絞れる。throw せず、エラー時は説明的なメモ文字列を返す。
   */
  searchRepoCode(repo: string, query: string, pat: string, path?: string): Promise<string>;
}
