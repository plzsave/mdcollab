import type { Status } from "../api/types";

// ステータスは利用者が自由に定義できるので、色は sortOrder の並び順でパレットから割り当てる。
// （id 固定だと draft/review/done を改名・差し替えしたとき破綻するため位置ベース）
const PALETTE = [
  "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200",
  "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
];

const UNSET_BADGE =
  "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500";

// 並び順 index ごとのドット色（サマリー用）。
const DOT = [
  "bg-slate-400",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
];

// statusId → バッジ用クラス。未設定/未知は淡いグレー。
export function statusBadgeClass(statusId: string | null, statuses: Status[]): string {
  if (!statusId) return UNSET_BADGE;
  const idx = orderIndex(statusId, statuses);
  return idx < 0 ? UNSET_BADGE : PALETTE[idx % PALETTE.length]!;
}

export function statusDotClass(statusId: string | null, statuses: Status[]): string {
  if (!statusId) return "bg-slate-300 dark:bg-slate-600";
  const idx = orderIndex(statusId, statuses);
  return idx < 0 ? "bg-slate-300" : DOT[idx % DOT.length]!;
}

function orderIndex(statusId: string, statuses: Status[]): number {
  const sorted = [...statuses].sort((a, b) => a.sortOrder - b.sortOrder);
  return sorted.findIndex((s) => s.id === statusId);
}
