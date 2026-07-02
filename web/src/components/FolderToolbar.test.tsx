import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// hooks / router / ダイアログ類はモックし、D&D 取り込み（#65）のフロント挙動を隔離検証する。
const importMutate = vi.fn(
  (
    files: { name: string; content: string }[],
    opts?: { onSuccess?: (results: { name: string; ok: boolean }[]) => void },
  ) => {
    opts?.onSuccess?.(files.map((f) => ({ name: f.name, ok: true })));
  },
);
vi.mock("../api/hooks", () => ({
  useCreateDocument: () => ({ mutate: vi.fn(), isPending: false, error: undefined }),
  useDeleteFolder: () => ({ mutate: vi.fn(), isPending: false, error: undefined }),
  useImportDocuments: () => ({ mutate: importMutate, isPending: false, error: undefined }),
  useRenameFolder: () => ({ mutate: vi.fn(), isPending: false, error: undefined }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./ui/confirm", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("./ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { FolderToolbar } from "./FolderToolbar";

const dt = (files: File[]) => ({ files, types: ["Files"] });

function renderToolbar() {
  return render(<FolderToolbar folderId="f1" folderName="資料" docCount={0} />);
}

beforeEach(() => {
  importMutate.mockClear();
});

describe("FolderToolbar の D&D 取り込み（#65）", () => {
  it("ファイルをドラッグするとドロップ帯が現れ、離れると消える", () => {
    renderToolbar();
    expect(screen.queryByTestId("md-dropzone")).toBeNull();
    fireEvent.dragEnter(window, { dataTransfer: dt([]) });
    expect(screen.getByTestId("md-dropzone")).toBeInTheDocument();
    fireEvent.dragLeave(window, { dataTransfer: dt([]) });
    expect(screen.queryByTestId("md-dropzone")).toBeNull();
  });

  it("ファイル以外のドラッグ（テキスト選択など）では帯を出さない", () => {
    renderToolbar();
    fireEvent.dragEnter(window, { dataTransfer: { files: [], types: ["text/plain"] } });
    expect(screen.queryByTestId("md-dropzone")).toBeNull();
  });

  it("複数の .md をドロップすると取り込み、.md 以外は送らず無視する", async () => {
    renderToolbar();
    fireEvent.dragEnter(window, { dataTransfer: dt([]) });
    const files = [
      new File(["# A"], "a.md", { type: "text/markdown" }),
      new File(["# B"], "b.markdown", { type: "text/markdown" }),
      new File(["x"], "image.png", { type: "image/png" }),
    ];
    fireEvent.drop(screen.getByTestId("md-dropzone"), { dataTransfer: dt(files) });

    await waitFor(() => expect(importMutate).toHaveBeenCalledTimes(1));
    expect(importMutate.mock.calls[0]?.[0]).toEqual([
      { name: "a.md", content: "# A" },
      { name: "b.markdown", content: "# B" },
    ]);
    expect(await screen.findByText(/取込: 成功 2（\.md \/ \.markdown 以外 1 件は無視）/)).toBeInTheDocument();
  });

  it(".md 以外だけのドロップは API を呼ばずメッセージだけ出す", async () => {
    renderToolbar();
    fireEvent.dragEnter(window, { dataTransfer: dt([]) });
    fireEvent.drop(screen.getByTestId("md-dropzone"), {
      dataTransfer: dt([new File(["x"], "image.png", { type: "image/png" })]),
    });
    expect(await screen.findByText(/取り込めるファイルがありません/)).toBeInTheDocument();
    expect(importMutate).not.toHaveBeenCalled();
  });
});
