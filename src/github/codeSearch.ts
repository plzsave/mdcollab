// repo 参照ツール強化（#82・kb-bot 逆輸入）の純関数部。ネットワーク非依存＝単体テスト可能。
// - renderTree: ツリーの整形（モノレポは概要化して subdir 深掘りへ誘導）
// - sliceLines: 行範囲の切り出し＋行番号付与（引用しやすく・トークン節約）
// - searchTerms / isTextPath / selectSearchCandidates / grepFiles: 自前 grep によるコード検索
//
// コード検索を GitHub の /search/code に依存させない理由（kb-bot #46 の教訓）:
// レガシー code search API は fine-grained PAT では常に 0 件を返し（エラーでなく静かに空）、
// 小規模リポは classic PAT でもインデックス欠落しうる。tree → blob 取得 → ローカル grep なら
// トークン種別にも GitHub のインデックスにも依存しない。

export const MAX_TREE = 500; // ファイル一覧（小規模リポ/サブディレクトリ）の件数上限
const MAX_OVERVIEW_DIRS = 60; // モノレポ概要で出すディレクトリ数の上限
const MAX_MANIFESTS = 100; // モノレポ概要で出す manifest（パッケージの目印）数の上限
export const MAX_RANGE_LINES = 400; // 行範囲指定時の最大行数
export const SEARCH_RESULTS = 20; // コード検索で返す path:line 行の総数上限
// grep のため blob 取得する候補ファイル数の上限。kb-bot（常駐・300 件）と違い、mdcollab は
// Workers 上で動く＝1 リクエストのサブリクエスト数に上限がある（無料プランは 50）。
// tree/meta 取得や他ツールの分も残すため、候補はパス名一致を優先した上位に絞る。
// 取りこぼしは path 引数で範囲を絞って回避する（ツール説明で誘導）。
export const MAX_GREP_FILES = 24;
export const MAX_GREP_BLOB = 256 * 1024; // grep 対象にする 1 ファイルの最大バイト（巨大生成物/lock を除外）
const MAX_MATCHES_PER_FILE = 3; // 1 ファイルから返す一致行の上限（結果をファイル横断で散らす）

// grep 対象にするテキスト系拡張子。バイナリ・巨大生成物・lock/min を除外して無駄な取得を避ける。
const TEXT_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|rb|php|cs|c|h|cc|cpp|hpp|swift|scala|sh|bash|zsh|sql|md|mdx|json|jsonc|toml|ya?ml|txt|html?|css|scss|sass|less|vue|svelte|gradle|xml|ini|cfg|conf|proto|graphql|gql|dockerfile)$/i;
const NON_TEXT =
  /(^|\/)(package-lock\.json|bun\.lock|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|composer\.lock|go\.sum)$|\.min\.(js|css)$|\.map$/i;

/** grep 対象にするテキストファイルか（拡張子で判定・lock/min は除外）。 */
export function isTextPath(path: string): boolean {
  if (NON_TEXT.test(path)) return false;
  return TEXT_EXT.test(path);
}

/** 検索語を空白区切りで語に分割（小文字化・トリム・重複除去）。識別子（TTL_MS 等）は分割しない。 */
export function searchTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * blob 取得する候補ファイルを選定して並べる。全ファイルを取りに行くと遅い上に Workers の
 * サブリクエスト上限に当たるため、(1) テキスト系のみに絞り、(2) パス名に検索語を多く含むものを
 * 優先し、(3) 一致 0 のファイルも後ろに残す（内容一致を拾うため）。
 * 安定ソート（同スコアは元順）で決定的。cap 件に切り詰める。
 */
export function selectSearchCandidates(paths: string[], terms: string[], cap = MAX_GREP_FILES): string[] {
  const textish = paths.filter(isTextPath);
  if (terms.length === 0) return textish.slice(0, cap);
  const score = (p: string) => {
    const lp = p.toLowerCase();
    return terms.reduce((n, t) => n + (lp.includes(t) ? 1 : 0), 0);
  };
  const indexed = textish.map((p, i) => ({ p, i, s: score(p) }));
  indexed.sort((a, b) => b.s - a.s || a.i - b.i);
  return indexed.slice(0, cap).map((x) => x.p);
}

export interface GrepMatch {
  path: string;
  line: number; // 1 始まり
  text: string;
}

/**
 * 候補ファイル（path + 内容）を grep して path:line 一致を返す。
 * まず「同一行に全語（AND）」で厳密一致を探し、総数 0 なら「いずれかの語（OR）」に緩めて必ず何かを返す
 * （空を返すとモデルが『コードに無い』と誤解するため。broadened で明示）。
 * files の順序（＝候補ランク順）を保ち、各ファイル内は行番号順。
 */
export function grepFiles(
  files: { path: string; content: string }[],
  terms: string[],
  opts: { maxTotal?: number; maxPerFile?: number } = {},
): { matches: GrepMatch[]; broadened: boolean } {
  const maxTotal = opts.maxTotal ?? SEARCH_RESULTS;
  const maxPerFile = opts.maxPerFile ?? MAX_MATCHES_PER_FILE;
  if (terms.length === 0) return { matches: [], broadened: false };

  const scan = (all: boolean): GrepMatch[] => {
    const out: GrepMatch[] = [];
    for (const f of files) {
      let perFile = 0;
      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i]!.toLowerCase();
        const hit = all ? terms.every((t) => lower.includes(t)) : terms.some((t) => lower.includes(t));
        if (!hit) continue;
        out.push({ path: f.path, line: i + 1, text: lines[i]!.trim().slice(0, 200) });
        if (++perFile >= maxPerFile) break;
        if (out.length >= maxTotal) return out;
      }
      if (out.length >= maxTotal) break;
    }
    return out;
  };

  const strict = scan(true);
  if (strict.length > 0) return { matches: strict, broadened: false };
  return { matches: scan(false), broadened: true };
}

// パッケージ/プロジェクトの根を示すファイル名。モノレポで「どこに何があるか」の地図になる。
const MANIFEST =
  /(^|\/)(package\.json|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|pyproject\.toml|setup\.py|Gemfile|composer\.json|[^/]+\.csproj)$/i;

/**
 * ツリー（blob パス一覧）を LLM 向け文字列に整形する。
 * - subdir 指定: その配下のファイルだけ列挙（モノレポで該当パッケージに絞る）。
 * - 未指定で小規模（MAX_TREE 以下）: 全ファイルを列挙（従来挙動）。
 * - 未指定で大規模（モノレポ）: トップ階層の概要＋manifest の場所を返し、subdir での深掘りを促す。
 *   全ファイルを並べると MAX_TREE 件で切れて目的のパッケージが地図から消えるのを防ぐ。
 */
export function renderTree(paths: string[], subdir?: string): string {
  if (paths.length === 0) return "（ファイルが見つかりません）";

  if (subdir) {
    const prefix = subdir.replace(/^\/+|\/+$/g, "") + "/";
    const inDir = paths.filter((p) => p.startsWith(prefix));
    if (inDir.length === 0) return `（${subdir} 配下にファイルが見つかりません）`;
    const shown = inDir.slice(0, MAX_TREE).join("\n");
    return inDir.length > MAX_TREE
      ? `${shown}\n（…${MAX_TREE} 件で切り詰め。subdir をさらに絞ってください）`
      : shown;
  }

  if (paths.length <= MAX_TREE) return paths.join("\n");

  // 大規模（モノレポ）→ 地図にして subdir 深掘りへ誘導
  const counts = new Map<string, number>();
  for (const p of paths) {
    const top = p.includes("/") ? p.slice(0, p.indexOf("/")) : "(root files)";
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  const dirs = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_OVERVIEW_DIRS)
    .map(([dir, n]) => (dir === "(root files)" ? `(root files)  (${n})` : `${dir}/  (${n})`))
    .join("\n");
  const manifests = paths.filter((p) => MANIFEST.test(p)).slice(0, MAX_MANIFESTS);

  return [
    `（${paths.length} ファイルと大きいため概要を表示。subdir を指定して深掘りしてください）`,
    "",
    "## トップ階層（ディレクトリ / ファイル数）",
    dirs,
    "",
    "## パッケージの目印（manifest の場所）",
    manifests.length ? manifests.join("\n") : "（manifest が見つかりません）",
  ].join("\n");
}

function withLineNumbers(text: string, from: number): string {
  return text
    .split("\n")
    .map((l, i) => `${String(from + i).padStart(5)}| ${l}`)
    .join("\n");
}

/**
 * ファイル本文から行範囲を切り出し、行番号付きで整形する（path:line 引用をしやすく）。
 * 範囲は 1 始まり・MAX_RANGE_LINES でガード。startLine 未指定はファイル全体（先頭から番号付き）。
 */
export function sliceLines(path: string, text: string, startLine?: number, endLine?: number): string {
  if (startLine == null) return `# ${path}\n${withLineNumbers(text, 1)}`;
  const lines = text.split("\n");
  const from = Math.max(1, Math.floor(startLine));
  const to = Math.min(
    lines.length,
    Math.floor(endLine ?? from + MAX_RANGE_LINES - 1),
    from + MAX_RANGE_LINES - 1,
  );
  const slice = lines.slice(from - 1, to).join("\n");
  return `# ${path} (L${from}-L${to} / 全${lines.length}行)\n${withLineNumbers(slice, from)}`;
}
