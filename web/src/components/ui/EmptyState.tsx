import type { ReactNode } from "react";

// 空状態の共通表示（#20）。アイコン + 見出し + 補助文 + 任意のアクション。
// 素の「○○はありません」テキストの代わりに、一貫した余白とトーンで提示する。
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900 " +
        className
      }
    >
      {icon && (
        <div className="mb-3 text-slate-300 dark:text-slate-600" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-slate-400 dark:text-slate-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
