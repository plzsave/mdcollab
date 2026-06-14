import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Modal } from "./Modal";

// ネイティブ window.confirm の置き換え。Promise を返し `if (await confirm({...}))` で使う（#19）。
// ダーク対応・破壊的アクションの色分け・アクセシブル（Modal が aria-modal/フォーカストラップを担保）。

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setState(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setState(null);
  }, []);

  const danger = state?.danger ?? false;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={state !== null}
        onClose={() => close(false)}
        labelledBy="confirm-title"
        describedBy={state?.message ? "confirm-message" : undefined}
        initialFocusRef={confirmBtnRef}
      >
        <h2 id="confirm-title" className="text-base font-semibold">
          {state?.title}
        </h2>
        {state?.message && (
          <p id="confirm-message" className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {state.message}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => close(false)}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {state?.cancelLabel ?? "キャンセル"}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => close(true)}
            className={
              danger
                ? "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                : "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            }
          >
            {state?.confirmLabel ?? "OK"}
          </button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
