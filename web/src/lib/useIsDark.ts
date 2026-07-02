import { useEffect, useState } from "react";

// html.dark クラス（applyTheme が付け外しする）の現在値に追従するフック。
// テーマ切替でテーマ依存の描画（mermaid の図など）をやり直すトリガに使う。
export function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
