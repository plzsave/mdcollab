import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import { useDeleteDocument, useSaveDocument, useThreads } from "../api/hooks";
import { renderMarkdown } from "../lib/markdown";
import { renderMermaidBlocks } from "../lib/mermaid";
import { applyHighlights } from "../lib/highlight";
import { clearDraft, loadDraft, saveDraft } from "../lib/draft";
import { CommentPanel, type DraftAnchor } from "./CommentPanel";
import { AiReviewPanel } from "./AiReviewPanel";
import { IconChat, IconMore } from "./icons";
import { useConfirm } from "./ui/confirm";
import { useToast } from "./ui/toast";
import { Modal } from "./ui/Modal";
import type { DocumentFull } from "../api/types";

type Mode = "edit" | "split" | "preview";

interface Bubble {
  x: number;
  y: number;
  text: string;
  before: string;
  after: string;
}

export function MarkdownEditor({ doc }: { doc: DocumentFull }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const save = useSaveDocument(doc.id);
  const del = useDeleteDocument(doc.folderId);
  const { data: threads } = useThreads(doc.id);

  const [content, setContent] = useState(doc.content);
  const [savedContent, setSavedContent] = useState(doc.content);
  const [baseVersion, setBaseVersion] = useState(doc.version);
  // 初期モード: md+ は分割、モバイルは編集（分割は狭い画面で潰れるため）。
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
      ? "split"
      : "edit",
  );
  const [conflict, setConflict] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [draft, setDraft] = useState<DraftAnchor | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [bubble, setBubble] = useState<Bubble | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);

  const dirty = content !== savedContent;
  const html = useMemo(() => renderMarkdown(content), [content]);

  // 未保存の下書き復元バナー（#22）。マウント時に doc 本文と異なる下書きがあれば提示。
  const [restorable, setRestorable] = useState<string | null>(() => {
    const d = loadDraft(doc.id);
    return d && d.content !== doc.content ? d.content : null;
  });

  // 離脱ガード（#22）: dirty の間は beforeunload（タブ閉じ/リロード）と
  // アプリ内ナビ（サイドバー遷移など）の両方をブロックする。
  // ただし削除による遷移はガード対象外（文書自体が消えるため）。
  const skipGuardRef = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => !skipGuardRef.current && dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  // dirty な本文を localStorage へ自動退避（デバウンス）。
  // クリーンになったら下書きを破棄するが、未操作の復元候補（restorable）が
  // 残っている初期マウント時は消さない（復元前に消えるのを防ぐ）。
  useEffect(() => {
    if (!dirty) {
      if (restorable === null) clearDraft(doc.id);
      return;
    }
    const t = window.setTimeout(() => {
      saveDraft(doc.id, { content, baseVersion, savedAt: Date.now() });
    }, 800);
    return () => window.clearTimeout(t);
  }, [content, dirty, baseVersion, doc.id, restorable]);

  // プレビューは手動で innerHTML を設定し、その上にコメントアンカーのハイライトを重ねる。
  // （dangerouslySetInnerHTML だと React 管理下と DOM 直接操作が衝突するため ref 制御にする）
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    el.innerHTML = html;
    if (threads && threads.length) applyHighlights(el, threads, activeThreadId);
    void renderMermaidBlocks(el); // ```mermaid を図へ差し替え（#62・非同期）
  }, [html, threads, activeThreadId, mode]);

  // アクティブなスレッドのハイライトへスクロール＆フラッシュ。
  useEffect(() => {
    if (!activeThreadId) return;
    const el = previewRef.current?.querySelector<HTMLElement>(
      `mark[data-thread-id="${activeThreadId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("comment-flash");
    const t = setTimeout(() => el.classList.remove("comment-flash"), 1300);
    return () => clearTimeout(t);
  }, [activeThreadId, focusTick, html, threads]);

  // プレビューでテキスト選択 → その場にフローティング「コメント」ボタンを出す。
  const onPreviewMouseUp = () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const el = previewRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !el) {
        setBubble(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const text = sel.toString().trim();
      if (!text || !el.contains(range.commonAncestorContainer)) {
        setBubble(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const sc = range.startContainer;
      const ec = range.endContainer;
      const before =
        sc.nodeType === Node.TEXT_NODE
          ? (sc.textContent ?? "").slice(Math.max(0, range.startOffset - 40), range.startOffset)
          : "";
      const after =
        ec.nodeType === Node.TEXT_NODE
          ? (ec.textContent ?? "").slice(range.endOffset, range.endOffset + 40)
          : "";
      setBubble({ x: rect.left + rect.width / 2, y: rect.top, text, before, after });
    }, 0);
  };

  // フローティングボタンから新規スレッドの下書きを開始。
  const startThreadFromSelection = () => {
    if (!bubble) return;
    setShowReview(false);
    setShowComments(true);
    setDraft({ text: bubble.text, before: bubble.before, after: bubble.after });
    setBubble(null);
    window.getSelection()?.removeAllRanges();
  };

  // ハイライト（mark）クリックでそのスレッドへフォーカス。
  const onPreviewClick = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest("mark[data-thread-id]") as HTMLElement | null;
    if (!mark) return;
    setShowReview(false);
    setShowComments(true);
    setActiveThreadId(mark.dataset.threadId ?? null);
    setFocusTick((t) => t + 1);
  };

  // パネル側のスレッドから本文の該当ハイライトへジャンプ。
  const focusThread = (id: string) => {
    setActiveThreadId(id);
    setFocusTick((t) => t + 1);
  };

  const openComments = () => {
    setShowReview(false);
    setShowComments(true);
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

  const deleteDoc = async () => {
    const ok = await confirm({
      title: "文書を削除しますか？",
      message: `「${doc.title}」を削除します。元に戻せません。`,
      confirmLabel: "削除",
      danger: true,
    });
    if (!ok) return;
    del.mutate(doc.id, {
      onSuccess: () => {
        skipGuardRef.current = true; // 削除遷移は離脱ガードを通さない
        clearDraft(doc.id);
        toast.success("文書を削除しました");
        navigate(
          doc.folderId
            ? { to: "/folders/$folderId", params: { folderId: doc.folderId } }
            : { to: "/" },
        );
      },
      onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
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
          toast.success("保存しました");
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

  // 下書き復元バナーの操作（#22）。
  const restoreDraft = () => {
    if (restorable !== null) setContent(restorable);
    setRestorable(null);
  };
  const discardDraft = () => {
    clearDraft(doc.id);
    setRestorable(null);
  };

  return (
    <div className="flex h-full gap-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-xl font-bold text-slate-800 dark:text-slate-100">
              {doc.title}
            </h1>
            <span className="shrink-0 text-xs text-slate-400">v{baseVersion}</span>
            {dirty && <span className="shrink-0 text-xs text-amber-600">● 未保存</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 text-xs">
              {(["edit", "split", "preview"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 ${m === "split" ? "hidden md:block" : ""} ${
                    mode === m ? "bg-slate-800 dark:bg-slate-700 text-white" : "bg-white dark:bg-slate-900 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
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
                  ? "border-sky-300 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300"
                  : "border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 dark:text-slate-200"
              }`}
            >
              コメント{threads && threads.length > 0 ? `（${threads.length}）` : ""}
            </button>
            <button
              onClick={openReview}
              className={`rounded-md border px-3 py-1.5 text-sm transition ${
                showReview
                  ? "border-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                  : "border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 dark:text-slate-200"
              }`}
            >
              AI レビュー
            </button>
            <button
              onClick={() => doSave(baseVersion)}
              disabled={!dirty || save.isPending}
              className="rounded-md bg-slate-800 dark:bg-slate-700 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-40"
            >
              {save.isPending ? "保存中…" : "保存"}
            </button>
            {/* デスクトップ: 副次アクションを横並びで表示 */}
            <button
              onClick={exportMd}
              title="Markdown をダウンロード"
              className="hidden rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm text-slate-500 hover:border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 dark:text-slate-200 md:block"
            >
              エクスポート
            </button>
            {/* 破壊的アクションは赤系で明示し、保存/エクスポートと視覚的に分離（誤クリック防止・#20） */}
            <button
              onClick={deleteDoc}
              disabled={del.isPending}
              className="ml-1 hidden rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40 md:block dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              削除
            </button>

            {/* モバイル: 副次アクションをオーバーフローメニューへ */}
            <div className="relative md:hidden">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="その他の操作"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <IconMore />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
                  >
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        exportMd();
                      }}
                      className="block w-full px-4 py-2 text-left text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      エクスポート
                    </button>
                    <button
                      role="menuitem"
                      disabled={del.isPending}
                      onClick={() => {
                        setMenuOpen(false);
                        deleteDoc();
                      }}
                      className="block w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40"
                    >
                      削除
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {mode !== "edit" && (
          <p className="mt-2 text-xs text-slate-400">
            プレビュー上で文章を選択すると「コメント」ボタンが出ます。ハイライトをクリックで該当スレッドへ。
          </p>
        )}

        {restorable !== null && (
          <div className="mt-3 flex items-center justify-between rounded-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800 dark:border-sky-900/60 dark:bg-sky-900/30 dark:text-sky-200">
            <span>保存されていない下書きが見つかりました。復元しますか？</span>
            <div className="flex gap-2">
              <button
                onClick={restoreDraft}
                className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700"
              >
                復元
              </button>
              <button
                onClick={discardDraft}
                className="rounded border border-sky-300 px-3 py-1 text-xs text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:text-sky-200 dark:hover:bg-sky-900/50"
              >
                破棄
              </button>
            </div>
          </div>
        )}

        {conflict !== null && (
          <div className="mt-3 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/40 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
            <span>他の人が更新しました（サーバは v{conflict}）。あなたの編集は保持しています。</span>
            <div className="flex gap-2">
              <button
                onClick={() => doSave(conflict)}
                className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
              >
                上書き保存
              </button>
              <button
                onClick={reloadLatest}
                className="rounded border border-amber-300 px-3 py-1 text-xs text-amber-800 dark:text-amber-200 hover:bg-amber-100"
              >
                最新を読み込む（編集破棄）
              </button>
            </div>
          </div>
        )}

        {save.error instanceof ApiError && save.error.status !== 409 && (
          <p className="mt-3 rounded-md bg-red-50 dark:bg-red-900/30 px-4 py-2 text-sm text-red-700 dark:text-red-300">
            保存に失敗しました: {save.error.message}
          </p>
        )}

        <div
          className={`mt-3 grid min-h-0 flex-1 gap-4 ${
            mode === "split" ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
          }`}
        >
          {mode !== "preview" && (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="h-full min-h-[60vh] w-full resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 font-mono text-sm leading-relaxed text-slate-800 dark:text-slate-100 focus:border-slate-400 focus:outline-none"
            />
          )}
          {mode !== "edit" && (
            <div
              ref={previewRef}
              onMouseUp={onPreviewMouseUp}
              onClick={onPreviewClick}
              className="md-preview h-full min-h-[60vh] w-full overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5"
            />
          )}
        </div>
      </div>

      {bubble && (
        <button
          onMouseDown={(e) => e.preventDefault()} // 選択を保持したままクリック
          onClick={startThreadFromSelection}
          className="comment-bubble flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-slate-700 dark:hover:bg-slate-600"
          style={{ left: bubble.x, top: bubble.y }}
        >
          <IconChat width={14} height={14} /> コメント
        </button>
      )}

      {showComments && (
        <CommentPanel
          documentId={doc.id}
          draft={draft}
          onClearDraft={() => setDraft(null)}
          onClose={() => setShowComments(false)}
          activeThreadId={activeThreadId}
          onFocusThread={focusThread}
        />
      )}

      {showReview && (
        <AiReviewPanel
          documentId={doc.id}
          onApplyRevision={(next) => setContent(next)}
          onClose={() => setShowReview(false)}
        />
      )}

      {/* アプリ内ナビ離脱の確認（#22）。beforeunload は useBlocker が別途担保。 */}
      <Modal
        open={blocker.status === "blocked"}
        onClose={() => blocker.reset?.()}
        labelledBy="leave-guard-title"
        describedBy="leave-guard-desc"
      >
        <h2 id="leave-guard-title" className="text-base font-semibold">
          未保存の変更があります
        </h2>
        <p id="leave-guard-desc" className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          保存していない編集があります。このページを離れると変更が失われます。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => blocker.reset?.()}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            編集を続ける
          </button>
          <button
            type="button"
            onClick={() => {
              clearDraft(doc.id);
              blocker.proceed?.();
            }}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            移動する（破棄）
          </button>
        </div>
      </Modal>
    </div>
  );
}
