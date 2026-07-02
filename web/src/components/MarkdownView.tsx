import { useEffect, useRef } from "react";
import { renderMermaidBlocks } from "../lib/mermaid";

// renderMarkdown 済み HTML を表示し、DOM 挿入後に mermaid ブロックを図へ差し替える薄いラッパ。
// dangerouslySetInnerHTML の直置きだと挿入後の後処理を掛けられないため、ここに集約する。
export function MarkdownView({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) void renderMermaidBlocks(ref.current);
  }, [html]);
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
