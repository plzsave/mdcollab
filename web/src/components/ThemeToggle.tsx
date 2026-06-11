import { useEffect, useRef, useState, type ReactNode } from "react";
import { applyTheme, getStoredTheme, setTheme, watchSystemTheme, type Theme } from "../lib/theme";
import { IconMonitor, IconMoon, IconSun } from "./icons";

const ORDER: Theme[] = ["system", "light", "dark"];
const ICON: Record<Theme, ReactNode> = {
  system: <IconMonitor />,
  light: <IconSun />,
  dark: <IconMoon />,
};
const LABEL: Record<Theme, string> = { system: "OS設定", light: "ライト", dark: "ダーク" };

// テーマ切替（system → light → dark を巡回）。system は OS 設定に追従。
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // system のとき OS のダーク切替に追従。
  useEffect(() => watchSystemTheme(() => themeRef.current), []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
    setTheme(next);
    setThemeState(next);
  };

  return (
    <button
      onClick={cycle}
      title={`テーマ: ${LABEL[theme]}（クリックで切替）`}
      className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 dark:hover:text-slate-200 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
    >
      {ICON[theme]} {LABEL[theme]}
    </button>
  );
}
