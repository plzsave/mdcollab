import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { useAiSettings, useCreateRevision, useReviews } from "../api/hooks";
import { streamReview, type ReviewToolEvent } from "../api/review-stream";
import { renderMarkdown } from "../lib/markdown";
import type { Review } from "../api/types";

// エージェントが呼んだツールを人間向けラベルに（§9 透明性＝何を読んだか可視化）。
function toolLabel({ name, arg }: ReviewToolEvent): string {
  switch (name) {
    case "fetch_repo_file":
      return `📄 ${String(arg.path ?? "")} を読み込み`;
    case "list_repo_tree":
      return "🗂 リポジトリのファイル一覧を取得";
    case "get_doc_threads":
      return "💬 コメントスレッドを参照";
    case "search_docs":
      return `🔎 「${String(arg.query ?? "")}」で文書を検索`;
    default:
      return `🛠 ${name}`;
  }
}

// AI レビュー側パネル（エディタ右）。SSE で逐次表示し、保存済みレビューも一覧。
// 改稿（全文書き直し）を生成し、onApply でエディタ本文へ反映できる。
export function AiReviewPanel({
  documentId,
  onApplyRevision,
  onClose,
}: {
  documentId: string;
  onApplyRevision: (content: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: settings } = useAiSettings();
  const { data: reviews } = useReviews(documentId);
  const revision = useCreateRevision(documentId);

  const [instructions, setInstructions] = useState("");
  const [useRepo, setUseRepo] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [tools, setTools] = useState<ReviewToolEvent[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revised, setRevised] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const configured = !!settings?.provider && !!settings.keys[settings.provider];
  // 改稿の入力に使う直近レビュー（ストリーム中の本文 or 保存済みの最新）。
  const latestReviewContent = streamText || reviews?.[0]?.content || "";

  const streamHtml = useMemo(() => (streamText ? renderMarkdown(streamText) : ""), [streamText]);

  const runReview = async () => {
    setError(null);
    setRevised(null);
    setStreamText("");
    setTools([]);
    setTruncated(false);
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await streamReview(
        documentId,
        { instructions: instructions.trim() || undefined, repo: useRepo },
        {
          onDelta: (t) => setStreamText((prev) => prev + t),
          onTool: (tool) => setTools((prev) => [...prev, tool]),
          onDone: (meta) => {
            setTruncated(!!meta.truncated);
            qc.invalidateQueries({ queryKey: ["reviews", documentId] });
          },
        },
        ac.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof ApiError ? e.message : "レビューに失敗しました");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const makeRevision = () => {
    setError(null);
    revision.mutate(
      { reviewContent: latestReviewContent || undefined, instructions: instructions.trim() || undefined },
      {
        onSuccess: (res) => setRevised(res.revised),
        onError: (e) => setError(e instanceof ApiError ? e.message : "改稿の生成に失敗しました"),
      },
    );
  };

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">AI レビュー</h2>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 dark:text-slate-200">
          閉じる
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!configured ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/40 p-3 text-sm text-amber-800 dark:text-amber-200">
            AI が未設定です。
            <Link to="/settings/ai" className="ml-1 underline hover:text-amber-900">
              AI 設定
            </Link>
            でプロバイダとキーを保存してください。
          </div>
        ) : (
          <>
            <label className="mb-1 block text-xs font-medium text-slate-500">指示（任意）</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="例: 冗長な箇所を簡潔に。専門用語に補足を。"
              className="h-16 w-full resize-none rounded border border-slate-200 dark:border-slate-700 p-2 text-sm focus:border-slate-400 focus:outline-none"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={useRepo}
                onChange={(e) => setUseRepo(e.target.checked)}
                disabled={!settings?.githubRepo}
              />
              リポジトリ参照を含める
              {!settings?.githubRepo && <span className="text-slate-400">（repo 未設定）</span>}
            </label>

            <div className="mt-2 flex gap-2">
              {streaming ? (
                <button
                  onClick={stop}
                  className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                >
                  停止
                </button>
              ) : (
                <button
                  onClick={runReview}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  レビュー実行
                </button>
              )}
              <button
                onClick={makeRevision}
                disabled={revision.isPending || streaming || !latestReviewContent}
                title={!latestReviewContent ? "先にレビューを実行してください" : ""}
                className="rounded border border-indigo-300 px-3 py-1.5 text-xs text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 disabled:opacity-40"
              >
                {revision.isPending ? "改稿生成中…" : "この指摘で改稿"}
              </button>
            </div>

            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

            {tools.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium text-slate-500">
                  参照したもの{streaming && " （実行中…）"}
                </div>
                <ul className="space-y-1">
                  {tools.map((t, i) => (
                    <li
                      key={i}
                      className="truncate rounded bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300"
                      title={toolLabel(t)}
                    >
                      {toolLabel(t)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {truncated && (
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                ⚠ ツール実行が上限に達したため、途中までの結果です。
              </p>
            )}

            {(streamText || streaming) && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium text-slate-500">
                  レビュー結果{streaming && " （生成中…）"}
                </div>
                <div
                  className="md-preview max-h-80 overflow-y-auto rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3"
                  dangerouslySetInnerHTML={{ __html: streamHtml }}
                />
              </div>
            )}

            {revised !== null && (
              <RevisionPreview
                revised={revised}
                onApply={() => {
                  onApplyRevision(revised);
                  setRevised(null);
                }}
                onDiscard={() => setRevised(null)}
              />
            )}

            <PastReviews reviews={reviews} />
          </>
        )}
      </div>
    </aside>
  );
}

function RevisionPreview({
  revised,
  onApply,
  onDiscard,
}: {
  revised: string;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/30 p-3">
      <div className="mb-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">改稿案（全文書き直し）</div>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded border border-indigo-100 bg-white dark:bg-slate-900 p-2 text-xs text-slate-700 dark:text-slate-200">
        {revised}
      </pre>
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={onDiscard} className="rounded px-3 py-1 text-xs text-slate-500 hover:bg-white dark:bg-slate-900">
          破棄
        </button>
        <button
          onClick={onApply}
          className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
        >
          エディタに反映
        </button>
      </div>
      <p className="mt-1 text-[11px] text-indigo-500">
        反映後、内容を確認してから「保存」してください。
      </p>
    </div>
  );
}

function PastReviews({ reviews }: { reviews: Review[] | undefined }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!reviews || reviews.length === 0) return null;

  return (
    <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3">
      <div className="mb-2 text-xs font-semibold text-slate-500">過去のレビュー（{reviews.length}）</div>
      <div className="space-y-1.5">
        {reviews.map((r) => {
          const expanded = open === r.id;
          return (
            <div key={r.id} className="rounded border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setOpen(expanded ? null : r.id)}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span>
                  {new Date(r.createdAt).toLocaleString("ja-JP", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  <span className="ml-2 text-slate-400">{r.model}</span>
                </span>
                <span className="text-slate-400">{expanded ? "▲" : "▼"}</span>
              </button>
              {expanded && (
                <div
                  className="md-preview border-t border-slate-100 dark:border-slate-800 px-3 py-2"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(r.content) }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
