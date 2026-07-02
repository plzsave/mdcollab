import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "../api/client";
import type { DocumentFull } from "../api/types";

// AiReviewPanel は改稿案を1つ流し込むだけのスタブにする（#64 の差分確認フロー検証用）。
// onApplyRevision の解決値（反映されたか）を applyResults に記録する。
const applyResults: boolean[] = [];
vi.mock("./AiReviewPanel", () => ({
  AiReviewPanel: ({ onApplyRevision }: { onApplyRevision: (c: string) => Promise<boolean> }) => (
    <button
      onClick={async () => {
        applyResults.push(await onApplyRevision("行1\n行A"));
      }}
    >
      改稿を反映(stub)
    </button>
  ),
}));

// hooks / router / query-client はプロバイダ不要にするためモックする。
// これにより MarkdownEditor 自身のロジック（dirty 表示・409 衝突バナー・上書き保存）を隔離して検証する。
const saveMutate = vi.fn();
const delMutate = vi.fn();

vi.mock("../api/hooks", () => ({
  useSaveDocument: () => ({ mutate: saveMutate, isPending: false, error: undefined }),
  useDeleteDocument: () => ({ mutate: delMutate, isPending: false }),
  useThreads: () => ({ data: [] }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ status: "idle", proceed: vi.fn(), reset: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
// Dialog/Toast プロバイダ非依存にするためフックをモック（本コンポーネントの検証対象外）。
vi.mock("./ui/confirm", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("./ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { MarkdownEditor } from "./MarkdownEditor";

function makeDoc(over: Partial<DocumentFull> = {}): DocumentFull {
  return {
    id: "doc1",
    folderId: "f1",
    title: "テスト文書",
    version: 3,
    statusId: null,
    archived: false,
    assignee: null,
    updatedAt: "2026-01-01T00:00:00Z",
    content: "# 元の本文",
    ...over,
  };
}

function editorTextarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

beforeEach(() => {
  saveMutate.mockReset();
  delMutate.mockReset();
  localStorage.clear();
  applyResults.length = 0;
});

describe("MarkdownEditor", () => {
  it("初期は未保存マークが出ず、保存ボタンは無効", () => {
    render(<MarkdownEditor doc={makeDoc()} />);
    expect(screen.queryByText("● 未保存")).toBeNull();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("本文を編集すると未保存マークが出て保存ボタンが有効になる", () => {
    render(<MarkdownEditor doc={makeDoc()} />);
    fireEvent.change(editorTextarea(), { target: { value: "# 編集後" } });
    expect(screen.getByText("● 未保存")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("doc 本文と異なる下書きがあれば復元バナーを出し、復元で本文へ反映する", () => {
    localStorage.setItem(
      "mdcollab:draft:doc1",
      JSON.stringify({ content: "# 下書き", baseVersion: 3, savedAt: 1 }),
    );
    render(<MarkdownEditor doc={makeDoc()} />);
    expect(screen.getByText("保存されていない下書きが見つかりました。復元しますか？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "復元" }));
    expect(editorTextarea().value).toBe("# 下書き");
  });

  it("下書きが doc 本文と同一なら復元バナーを出さない", () => {
    localStorage.setItem(
      "mdcollab:draft:doc1",
      JSON.stringify({ content: "# 元の本文", baseVersion: 3, savedAt: 1 }),
    );
    render(<MarkdownEditor doc={makeDoc()} />);
    expect(screen.queryByText(/下書きが見つかりました/)).toBeNull();
  });

  it("保存時は現在の baseVersion で mutate を呼ぶ", () => {
    render(<MarkdownEditor doc={makeDoc({ version: 3 })} />);
    fireEvent.change(editorTextarea(), { target: { value: "新本文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(saveMutate.mock.calls[0]?.[0]).toEqual({ content: "新本文", baseVersion: 3 });
  });

  it("409 が返ると衝突バナーを表示し、サーバ current バージョンを示す", () => {
    saveMutate.mockImplementation((_vars, opts) => {
      opts.onError(new ApiError(409, "CONFLICT", "conflict", { current: 9 }));
    });
    render(<MarkdownEditor doc={makeDoc({ version: 3 })} />);
    fireEvent.change(editorTextarea(), { target: { value: "新本文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText(/サーバは v9/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上書き保存" })).toBeInTheDocument();
  });

  it("プレビューの集計チェックボックスのトグルがソースへ書き戻され、クリーン時は自動保存される", async () => {
    const table = ["<!-- 集計 -->", "| 項目 | チェック |", "| --- | --- |", "| a | [ ] |"].join(
      "\n",
    );
    render(<MarkdownEditor doc={makeDoc({ content: table, version: 3 })} />);
    fireEvent.click(screen.getByRole("button", { name: "プレビュー" }));

    const box = document.querySelector<HTMLInputElement>("input.table-check")!;
    expect(box).not.toBeNull();
    expect(box.disabled).toBe(false); // エディタのプレビューでは有効化される
    fireEvent.click(box);

    // デバウンス（600ms）後に現在の baseVersion で PUT される
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const vars = saveMutate.mock.calls[0]?.[0] as { content: string; baseVersion: number };
    expect(vars.baseVersion).toBe(3);
    expect(vars.content).toContain("| a | [x] |");
  });

  it("他に未保存の編集があるとトグルは dirty に積むだけで自動保存しない", async () => {
    const table = ["<!-- 集計 -->", "| 項目 | チェック |", "| --- | --- |", "| a | [ ] |"].join(
      "\n",
    );
    render(<MarkdownEditor doc={makeDoc({ content: table, version: 3 })} />);
    // 先に本文を編集して dirty にする
    fireEvent.change(editorTextarea(), { target: { value: `${table}\n追記` } });
    fireEvent.click(screen.getByRole("button", { name: "プレビュー" }));
    fireEvent.click(document.querySelector<HTMLInputElement>("input.table-check")!);

    // トグル自体はソースへ反映される（編集へ戻して確認）
    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    expect(editorTextarea().value).toContain("| a | [x] |");
    expect(editorTextarea().value).toContain("追記");
    // 自動保存はされない
    await new Promise((r) => setTimeout(r, 800));
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("AI 改稿案は差分モーダルで確認してから反映される（#64）", async () => {
    render(<MarkdownEditor doc={makeDoc({ content: "行1\n行2" })} />);
    fireEvent.click(screen.getByRole("button", { name: "AI レビュー" }));
    fireEvent.click(screen.getByRole("button", { name: "改稿を反映(stub)" }));

    // いきなり置換されず、差分モーダルが開く（del: 行2 / add: 行A）
    expect(editorTextarea().value).toBe("行1\n行2");
    expect(screen.getByText("改稿案の差分確認")).toBeInTheDocument();
    expect(document.querySelector(".diff-del")?.textContent).toContain("行2");
    expect(document.querySelector(".diff-add")?.textContent).toContain("行A");

    fireEvent.click(screen.getByRole("button", { name: "エディタに反映" }));
    expect(editorTextarea().value).toBe("行1\n行A");
    await waitFor(() => expect(applyResults).toEqual([true]));
  });

  it("差分モーダルをキャンセルすると本文は変わらず、改稿案側へ false を返す（#64）", async () => {
    render(<MarkdownEditor doc={makeDoc({ content: "行1\n行2" })} />);
    fireEvent.click(screen.getByRole("button", { name: "AI レビュー" }));
    fireEvent.click(screen.getByRole("button", { name: "改稿を反映(stub)" }));
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(editorTextarea().value).toBe("行1\n行2");
    expect(screen.queryByText("改稿案の差分確認")).toBeNull();
    await waitFor(() => expect(applyResults).toEqual([false]));
  });

  it("未保存の編集があると差分モーダルに警告を出す（#64）", () => {
    render(<MarkdownEditor doc={makeDoc({ content: "行1" })} />);
    fireEvent.change(editorTextarea(), { target: { value: "行1（編集中）" } });
    fireEvent.click(screen.getByRole("button", { name: "AI レビュー" }));
    fireEvent.click(screen.getByRole("button", { name: "改稿を反映(stub)" }));
    expect(screen.getByText(/未保存の編集があります。反映するとその内容ごと/)).toBeInTheDocument();
  });

  it("上書き保存はサーバ current バージョンを baseVersion に使う", () => {
    // 1回目: 409 を返す。2回目（上書き）は何もしない。
    saveMutate.mockImplementationOnce((_vars, opts) => {
      opts.onError(new ApiError(409, "CONFLICT", "conflict", { current: 9 }));
    });
    render(<MarkdownEditor doc={makeDoc({ version: 3 })} />);
    fireEvent.change(editorTextarea(), { target: { value: "新本文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: "上書き保存" }));
    expect(saveMutate).toHaveBeenCalledTimes(2);
    // 2回目は current(9) を baseVersion に
    expect(saveMutate.mock.calls[1]?.[0]).toEqual({ content: "新本文", baseVersion: 9 });
  });
});
