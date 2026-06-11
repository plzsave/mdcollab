// テーマ（light / dark / system）。system は OS の prefers-color-scheme に追従。
// 実際の dark 適用は html 要素に `dark` クラスを付け外しして行う（styles.css の @custom-variant と一致）。

export type Theme = "light" | "dark" | "system";

const KEY = "mdcollab-theme";
const mql = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getStoredTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

// 実効ダーク判定（system のときは OS 設定）。
export function isDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && mql().matches);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", isDark(theme));
}

export function setTheme(theme: Theme): void {
  if (theme === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

// system のとき OS 設定の変更へ追従するリスナを張る。戻り値で解除。
export function watchSystemTheme(getTheme: () => Theme): () => void {
  const m = mql();
  const handler = () => {
    if (getTheme() === "system") applyTheme("system");
  };
  m.addEventListener("change", handler);
  return () => m.removeEventListener("change", handler);
}
