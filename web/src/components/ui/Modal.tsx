import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// CSP セーフ（インライン style/外部 UI ライブラリ非依存）なアクセシブルモーダル。
// WAI-ARIA APG Dialog 準拠: role=dialog / aria-modal / フォーカストラップ / Esc / 復帰フォーカス。
// Tailwind クラスのみで描画し、style-src 'self' を緩めない（#9 維持）。

// フォーカス可能要素のセレクタ（tabindex=-1 は除外）。
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  children,
  labelledBy,
  describedBy,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // 開いた時点のフォーカス元を覚えておき、閉じたら戻す。
    prevFocusRef.current = document.activeElement as HTMLElement | null;

    // 背面スクロールをロック。
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 初期フォーカス: 指定 > 最初のフォーカス可能要素 > ダイアログ本体。
    const dialog = dialogRef.current;
    const focusTarget =
      initialFocusRef?.current ??
      dialog?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialog;
    focusTarget?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      // フォーカストラップ: Tab/Shift+Tab を端で折り返す。
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      prevFocusRef.current?.focus?.();
    };
  }, [open, onClose, initialFocusRef]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景クリックで閉じる（ダイアログ本体クリックは伝播させない） */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-lg bg-white p-5 shadow-xl outline-none dark:bg-slate-800 dark:text-slate-100"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
