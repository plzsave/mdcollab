import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ConfirmProvider, useConfirm } from "./confirm";

// confirm() の Promise が解決される/ダイアログのアクセシビリティ（aria-modal・Esc）を検証（#18/#19）。
function Harness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () => onResult(await confirm({ title: "削除しますか？", danger: true }))}
    >
      開く
    </button>
  );
}

function setup() {
  const results: boolean[] = [];
  render(
    <ConfirmProvider>
      <Harness onResult={(v) => results.push(v)} />
    </ConfirmProvider>,
  );
  return results;
}

describe("ConfirmProvider", () => {
  it("確認ボタンで true を解決し、role=dialog/aria-modal を持つ", async () => {
    const results = setup();
    fireEvent.click(screen.getByText("開く"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("削除しますか？")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(results).toEqual([true]));
    // 解決後はダイアログが閉じる。
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("キャンセルで false を解決する", async () => {
    const results = setup();
    fireEvent.click(screen.getByText("開く"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(results).toEqual([false]));
  });

  it("Escape キーで false を解決して閉じる", async () => {
    const results = setup();
    fireEvent.click(screen.getByText("開く"));
    await screen.findByRole("dialog");
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => expect(results).toEqual([false]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
