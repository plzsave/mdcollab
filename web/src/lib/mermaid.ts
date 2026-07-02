// #62: ```mermaid ブロックを SVG 図として描画する DOM 後処理。
// renderMarkdown（同期・サニタイズ済み文字列）はブロックを pre > code.language-mermaid の
// まま残すので、DOM 挿入後にこの後処理を呼んで図へ差し替える。
// mermaid 本体は大きいため動的 import（mermaid を含む文書を開いた時だけロード）。
//
// テーマ: 呼び出し時点の html.dark で dark / default を選ぶ。描画済みの図には
// data-mermaid-src / data-mermaid-theme を残しておき、テーマが変わった後の呼び出しで
// 同じソースから描き直す（useIsDark 経由で各コンポーネントが再呼び出しする）。

type MermaidModule = typeof import("mermaid").default;

let loader: Promise<MermaidModule> | null = null;
let currentTheme: "dark" | "default" | null = null;
let seq = 0;

// 同一ソースの再描画（編集中のキーストロークごとのプレビュー更新）を避けるキャッシュ。
// テーマ込みでキーにする（テーマ切替後の描き直しで配色が追従するように）。
const svgCache = new Map<string, string>();
const CACHE_MAX = 50;

async function loadMermaid(dark: boolean): Promise<MermaidModule> {
  if (!loader) loader = import("mermaid").then((m) => m.default);
  const mermaid = await loader;
  const theme = dark ? "dark" : "default";
  if (theme !== currentTheme) {
    // securityLevel strict: ラベル内 HTML やクリックイベントを無効化（XSS 対策）
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme });
    currentTheme = theme;
  }
  return mermaid;
}

// 1ブロック分を描画して差し替え先の要素を返す。構文エラーはブロック単位で握り
// （.mermaid-error にソースを残す）、他要素は壊さない。
async function renderOne(
  mermaid: MermaidModule,
  src: string,
  themeKey: "dark" | "light",
): Promise<HTMLElement> {
  const block = document.createElement("div");
  const cacheKey = `${themeKey}:${src}`;

  const cached = svgCache.get(cacheKey);
  if (cached !== undefined) {
    block.className = "mermaid-figure";
    block.innerHTML = cached;
    block.dataset.mermaidSrc = src;
    block.dataset.mermaidTheme = themeKey;
    return block;
  }

  const id = `mermaid-${++seq}`;
  try {
    const { svg } = await mermaid.render(id, src);
    if (svgCache.size >= CACHE_MAX) {
      const oldest = svgCache.keys().next().value;
      if (oldest !== undefined) svgCache.delete(oldest);
    }
    svgCache.set(cacheKey, svg);
    block.className = "mermaid-figure";
    block.innerHTML = svg;
    block.dataset.mermaidSrc = src;
    block.dataset.mermaidTheme = themeKey;
  } catch {
    // render が失敗時に一時要素を残すことがあるため掃除する
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
    block.className = "mermaid-error";
    const label = document.createElement("p");
    label.textContent = "Mermaid の構文エラーのため図を描画できません";
    const dump = document.createElement("pre");
    dump.textContent = src;
    block.append(label, dump);
  }
  return block;
}

// container 内の mermaid ブロックを図へ差し替える。対象は
// (a) 未描画のコードブロック、(b) 描画済みだがテーマが現在と違う図（テーマ切替後の描き直し）。
export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const dark = document.documentElement.classList.contains("dark");
  const themeKey: "dark" | "light" = dark ? "dark" : "light";
  const fresh = [...container.querySelectorAll<HTMLElement>("pre > code.language-mermaid")].map(
    (code) => ({ el: code.parentElement, src: code.textContent ?? "" }),
  );
  const stale = [...container.querySelectorAll<HTMLElement>(".mermaid-figure[data-mermaid-src]")]
    .filter((el) => el.dataset.mermaidTheme !== themeKey)
    .map((el) => ({ el: el as HTMLElement | null, src: el.dataset.mermaidSrc ?? "" }));
  const targets = [...fresh, ...stale].filter(
    (t): t is { el: HTMLElement; src: string } => t.el !== null,
  );
  if (targets.length === 0) return; // mermaid 無しの文書はロードも走らない

  const mermaid = await loadMermaid(dark);
  for (const { el, src } of targets) {
    // await 中にプレビューが再描画（innerHTML 差し替え）されたら古いノードには触らない
    if (!el.isConnected) continue;
    const block = await renderOne(mermaid, src, themeKey);
    if (el.isConnected) el.replaceWith(block);
  }
}
