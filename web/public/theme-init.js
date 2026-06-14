// 初回描画前にダークを適用してチラつきを防ぐ（lib/theme.ts と同じキー/規則）。
// CSP 対応のため index.html のインライン script から外部化（script-src 'self' で許可）。
(function () {
  try {
    var t = localStorage.getItem("mdcollab-theme");
    var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
