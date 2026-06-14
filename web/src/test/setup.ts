import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom には matchMedia が無い。レスポンシブ初期判定で使うコンポーネントのため最小実装を入れる。
// 既定は「非マッチ（= モバイル幅）」。デスクトップ挙動を見たいテストは個別に上書きする。
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// 各テスト後に React のレンダーツリーを破棄（DOM リークを防ぐ）。
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
