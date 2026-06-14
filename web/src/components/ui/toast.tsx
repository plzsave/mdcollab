import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconX } from "../icons";

// 成功/失敗フィードバックのトースト（#19）。sonner 等の外部 UI ライブラリは CSP（style-src 'self'）
// と相性が悪いため自前実装。Tailwind クラスのみ・依存ゼロ。
// 成功は aria-live=polite、失敗は role=alert（assertive）でスクリーンリーダに通知。

type ToastKind = "success" | "error";
type ToastItem = { id: number; kind: ToastKind; message: string };

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api = useRef<ToastApi>({
    success: (m) => push("success", m),
    error: (m) => push("error", m),
  });
  // push が再生成されても同一参照の api 経由で最新を呼ぶ。
  api.current.success = (m) => push("success", m);
  api.current.error = (m) => push("error", m);

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={
              "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg " +
              (t.kind === "error"
                ? "bg-red-600 text-white"
                : "bg-slate-800 text-white dark:bg-slate-700")
            }
          >
            <span className="mt-0.5 shrink-0">
              {t.kind === "error" ? <IconAlert /> : <IconCheck />}
            </span>
            <span className="flex-1 break-words">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="閉じる"
              className="shrink-0 rounded p-0.5 text-white/70 hover:text-white"
            >
              <IconX />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
