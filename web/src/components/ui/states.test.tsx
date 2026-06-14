import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState } from "./EmptyState";
import { FullScreenError } from "./ErrorState";

describe("EmptyState", () => {
  it("見出しと補助文を表示する", () => {
    render(<EmptyState title="通知はありません" description="ここに表示されます" />);
    expect(screen.getByText("通知はありません")).toBeInTheDocument();
    expect(screen.getByText("ここに表示されます")).toBeInTheDocument();
  });
});

describe("FullScreenError", () => {
  it("再試行ボタンでハンドラを呼ぶ", () => {
    const onRetry = vi.fn();
    render(<FullScreenError message="Bad Gateway" onRetry={onRetry} />);
    expect(screen.getByText("Bad Gateway")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("showLogin でログイン導線を出す", () => {
    render(<FullScreenError message="err" showLogin />);
    const link = screen.getByRole("link", { name: "ログインし直す" });
    expect(link).toHaveAttribute("href", "/api/auth/login");
  });

  it("onRetry 未指定なら再試行ボタンを出さない", () => {
    render(<FullScreenError message="err" />);
    expect(screen.queryByRole("button", { name: "再試行" })).toBeNull();
  });
});
