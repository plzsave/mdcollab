import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ToastProvider, useToast } from "./toast";

function Harness() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success("保存しました")}>成功</button>
      <button onClick={() => toast.error("失敗しました")}>失敗</button>
    </>
  );
}

function setup() {
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

describe("ToastProvider", () => {
  it("成功トーストは role=status で表示される", () => {
    setup();
    fireEvent.click(screen.getByText("成功"));
    const t = screen.getByRole("status");
    expect(t).toHaveTextContent("保存しました");
  });

  it("失敗トーストは role=alert で表示される", () => {
    setup();
    fireEvent.click(screen.getByText("失敗"));
    expect(screen.getByRole("alert")).toHaveTextContent("失敗しました");
  });

  it("閉じるボタンで消える", () => {
    setup();
    fireEvent.click(screen.getByText("成功"));
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("一定時間後に自動で消える", () => {
    vi.useFakeTimers();
    try {
      setup();
      fireEvent.click(screen.getByText("成功"));
      expect(screen.getByRole("status")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
