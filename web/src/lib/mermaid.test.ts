import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderMermaidBlocks } from "./mermaid";
import { renderMarkdown } from "./markdown";

// mermaid 本体は jsdom で動かない（SVG 計測が要る）ため動的 import をモックする。
// ソースに "BROKEN" を含むブロックは構文エラーとして reject させる。
const renderMock = vi.hoisted(() =>
  vi.fn(async (_id: string, src: string) => {
    if (src.includes("BROKEN")) throw new Error("parse error");
    return { svg: `<svg role="graphics-document"><desc>${src.trim()}</desc></svg>` };
  }),
);
const initializeMock = vi.hoisted(() => vi.fn());
vi.mock("mermaid", () => ({ default: { render: renderMock, initialize: initializeMock } }));

function mount(md: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = renderMarkdown(md);
  document.body.appendChild(div);
  return div;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
  renderMock.mockClear();
  initializeMock.mockClear();
});

describe("renderMermaidBlocks", () => {
  it("```mermaid ブロックが SVG 図（.mermaid-figure）に差し替わる", async () => {
    const el = mount("前\n\n```mermaid\ngraph TD; A-->B;\n```\n\n後");
    await renderMermaidBlocks(el);
    const fig = el.querySelector(".mermaid-figure");
    expect(fig).not.toBeNull();
    expect(fig?.querySelector("svg")).not.toBeNull();
    expect(el.querySelector("code.language-mermaid")).toBeNull();
    // 前後の要素は無傷
    expect(el.textContent).toContain("前");
    expect(el.textContent).toContain("後");
  });

  it("構文エラーは当該ブロックだけエラー表示になり、他のブロックは描画される", async () => {
    const el = mount(
      ["```mermaid", "BROKEN !!", "```", "", "```mermaid", "graph TD; A-->B;", "```"].join("\n"),
    );
    await renderMermaidBlocks(el);
    const err = el.querySelector(".mermaid-error");
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain("構文エラー");
    expect(err?.querySelector("pre")?.textContent).toContain("BROKEN"); // ソースは残す
    expect(el.querySelector(".mermaid-figure svg")).not.toBeNull();
  });

  it("mermaid ブロックが無ければ何もしない（mermaid をロードしない）", async () => {
    const el = mount("# 見出し\n\n```ts\nconst a = 1;\n```");
    await renderMermaidBlocks(el);
    expect(renderMock).not.toHaveBeenCalled();
    expect(el.querySelector("pre code")).not.toBeNull();
  });

  it("同一ソースはキャッシュされ 2 回目以降 render を呼ばない", async () => {
    const md = "```mermaid\ngraph LR; X-->Y;\n```";
    await renderMermaidBlocks(mount(md));
    const calls = renderMock.mock.calls.length;
    await renderMermaidBlocks(mount(md));
    expect(renderMock.mock.calls.length).toBe(calls);
  });

  it("ダークモードでは theme: dark で初期化される", async () => {
    document.documentElement.classList.add("dark");
    await renderMermaidBlocks(mount("```mermaid\ngraph TD; D-->E;\n```"));
    expect(initializeMock).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
  });
});
