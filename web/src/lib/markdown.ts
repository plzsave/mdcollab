import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: false });

// Markdown → サニタイズ済み HTML。dangerouslySetInnerHTML に渡す前に必ず通す。
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md ?? "", { async: false });
  return DOMPurify.sanitize(raw);
}
