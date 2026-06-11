import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import { useDeleteDocument, useSaveDocument } from "../api/hooks";
import { renderMarkdown } from "../lib/markdown";
import { CommentPanel, type DraftAnchor } from "./CommentPanel";
import { AiReviewPanel } from "./AiReviewPanel";
import type { DocumentFull } from "../api/types";

type Mode = "edit" | "split" | "preview";

export function MarkdownEditor({ doc }: { doc: DocumentFull }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const save = useSaveDocument(doc.id);
  const del = useDeleteDocument(doc.folderId);

  const [content, setContent] = useState(doc.content);
  const [savedContent, setSavedContent] = useState(doc.content);
  const [baseVersion, setBaseVersion] = useState(doc.version);
  const [mode, setMode] = useState<Mode>("split");
  const [conflict, setConflict] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const [showComments, setShowComments] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [draft, setDraft] = useState<DraftAnchor | null>(null);

  const dirty = content !== savedContent;
  const html = useMemo(() => renderMarkdown(content), [content]);

  const captureSelection = () => {
    const ta = textareaRef.current;
    if (ta) selRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
  };

  // パネルを開き、本文に選択範囲があれば新規スレッドの下書きアンカーを用意する。
  const openComments = () => {
    setShowReview(false);
    setShowComments(true);
    const { start, end } = selRef.current;
    if (end > start) {
      setDraft({
        text: content.slice(start, end),
        before: content.slice(Math.max(0, start - 40), start),
        after: content.slice(end, end + 40),
      });
    }
  };

  const openReview = () => {
    setShowComments(false);
    setShowReview(true);
  };

  // 現在の本文（編集中含む）を .md としてダウンロード。
  const exportMd = () => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteDoc = () => {
    if (!confirm(`文書「${doc.title}」を削除しますか？元に戻せません。`)) return;
    del.mutate(doc.id, {
      onSuccess: () =>
        navigate(
          doc.folderId
            ? { to: "/folders/$folderId", params: { folderId: doc.folderId } }
            : { to: "/" },
        ),
    });
  };

  const doSave = (version: number) => {
    setConflict(null);
    save.mutate(
      { content, baseVersion: version },
      {
        onSuccess: (res) => {
          setBaseVersion(res.version);
          setSavedContent(content);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            const current = (err.data as { current?: number })?.current;
            setConflict(typeof current === "number" ? current : baseVersion);
          }
        },
      },
    );
  };

  // 最新をサーバから取得して自分の編集を破棄。
  const reloadLatest = async () => {
    const latest = await api.get<DocumentFull>(`/api/documents/${doc.id}`);
    setContent(latest.content);
    setSavedContent(latest.content);
    setBaseVersion(latest.version);
    setConflict(null);
    qc.invalidateQueries({ queryKey: ["document", doc.id] });
  };

  return (
    <div className="flex h-full gap-4">
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">{doc.title}</h1>
          <span className="text-xs text-slate-400">v{baseVersion}</span>
          {dirty && <span className="text-xs text-amber-600">● 未保存</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-slate-200 text-xs">
            {(["edit", "split", "preview"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 ${
                  mode === m ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {m === "edit" ? "編集" : m === "split" ? "分割" : "プレビュー"}
              </button>
            ))}
          </div>
          <button
            onClick={openComments}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              showComments
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            コメント
          </button>
          <button
            onClick={openReview}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              showReview
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            AI レビュー
          </button>
          <button
            onClick={() => doSave(baseVersion)}
            disabled={!dirty || save.isPending}
            className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-40"
          >
            {save.isPending ? "保存中…" : "保存"}
          </button>
          <button
            onClick={exportMd}
            title="Markdown をダウンロード"
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
          >
            エクスポート
          </button>
          <button
            onClick={deleteDoc}
            disabled={del.isPending}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          >
            削除
          </button>
        </div>
      </div>

      {conflict !== null && (
        <div className="mt-3 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span>
            他の人が更新しました（サーバは v{conflict}）。あなたの編集は保持しています。
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => doSave(conflict)}
              className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
            >
              上書き保存
            </button>
            <button
              onClick={reloadLatest}
              className="rounded border border-amber-300 px-3 py-1 text-xs text-amber-800 hover:bg-amber-100"
            >
              最新を読み込む（編集破棄）
            </button>
          </div>
        </div>
      )}

      {save.error instanceof ApiError && save.error.status !== 409 && (
        <p className="mt-3 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
          保存に失敗しました: {save.error.message}
        </p>
      )}

      <div className="mt-4 grid min-h-0 flex-1 gap-4" style={gridCols(mode)}>
        {mode !== "preview" && (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onSelect={captureSelection}
            spellCheck={false}
            className="h-full min-h-[60vh] w-full resize-none rounded-lg border border-slate-200 bg-white p-4 font-mono text-sm leading-relaxed text-slate-800 focus:border-slate-400 focus:outline-none"
          />
        )}
        {mode !== "edit" && (
          <div
            className="md-preview h-full min-h-[60vh] w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-5"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
      </div>

      {showComments && (
        <CommentPanel
          documentId={doc.id}
          draft={draft}
          onClearDraft={() => setDraft(null)}
          onClose={() => setShowComments(false)}
        />
      )}

      {showReview && (
        <AiReviewPanel
          documentId={doc.id}
          onApplyRevision={(next) => setContent(next)}
          onClose={() => setShowReview(false)}
        />
      )}
    </div>
  );
}

function gridCols(mode: Mode): React.CSSProperties {
  return { gridTemplateColumns: mode === "split" ? "1fr 1fr" : "1fr" };
}
