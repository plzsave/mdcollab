import { useEffect, useRef, useState } from "react";
import {
  useAppState,
  useAddReply,
  useCreateThread,
  useDeleteComment,
  useEditComment,
  useSetThreadStatus,
  useThreads,
} from "../api/hooks";
import type { Comment, Member, Thread } from "../api/types";

export interface DraftAnchor {
  text: string;
  before: string;
  after: string;
}

// 文書のスレッド側パネル。選択範囲アンカーで新規スレッド作成・返信・解決/再開・編集/削除。
export function CommentPanel({
  documentId,
  draft,
  onClearDraft,
  onClose,
  activeThreadId,
  onFocusThread,
}: {
  documentId: string;
  draft: DraftAnchor | null;
  onClearDraft: () => void;
  onClose: () => void;
  activeThreadId?: string | null;
  onFocusThread?: (threadId: string) => void;
}) {
  const { data: state } = useAppState();
  const { data: threads, isLoading } = useThreads(documentId);

  const members = state?.members ?? [];
  const currentEmail = state?.currentUser.email ?? "";
  const nameOf = (email: string) => members.find((m) => m.email === email)?.displayName || email;

  // 既定は未解決のみ（GAS 版踏襲）。トグルで解決済みも表示。
  const [showResolved, setShowResolved] = useState(false);
  const all = threads ?? [];
  const openCount = all.filter((t) => t.status === "open").length;
  const resolvedCount = all.length - openCount;
  // open を先頭、resolved を後ろに。
  const sorted = all
    .filter((t) => showResolved || t.status === "open")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1));

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 lg:w-96">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          コメント
          {threads && (
            <span className="ml-2 text-xs font-normal text-slate-400">未解決 {openCount}</span>
          )}
        </h2>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-700 dark:text-slate-200">
          閉じる
        </button>
      </div>

      {resolvedCount > 0 && (
        <div className="border-b border-slate-100 dark:border-slate-800 px-4 py-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            解決済みも表示（{resolvedCount}）
          </label>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {draft && (
          <NewThreadComposer
            documentId={documentId}
            draft={draft}
            members={members}
            currentEmail={currentEmail}
            onDone={onClearDraft}
          />
        )}

        {isLoading && <p className="text-sm text-slate-400">読み込み中…</p>}
        {threads && threads.length === 0 && !draft && (
          <p className="text-sm text-slate-400">
            まだコメントはありません。本文を選択して「コメント」を押すとスレッドを作成できます。
          </p>
        )}

        <div className="space-y-3">
          {sorted.map((t) => (
            <ThreadCard
              key={t.id}
              documentId={documentId}
              thread={t}
              members={members}
              currentEmail={currentEmail}
              nameOf={nameOf}
              active={t.id === activeThreadId}
              onFocus={onFocusThread}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function NewThreadComposer({
  documentId,
  draft,
  members,
  currentEmail,
  onDone,
}: {
  documentId: string;
  draft: DraftAnchor;
  members: Member[];
  currentEmail: string;
  onDone: () => void;
}) {
  const create = useCreateThread(documentId);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);

  const submit = () => {
    if (!text.trim()) return;
    create.mutate(
      {
        anchorText: draft.text,
        anchorBefore: draft.before || undefined,
        anchorAfter: draft.after || undefined,
        firstComment: text.trim(),
        mentions: mentions.length ? mentions : undefined,
      },
      {
        onSuccess: () => {
          setText("");
          setMentions([]);
          onDone();
        },
      },
    );
  };

  return (
    <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 dark:bg-sky-900/30 p-3">
      <div className="mb-2 text-xs font-medium text-sky-700 dark:text-sky-300">新規スレッド</div>
      <AnchorQuote text={draft.text} />
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="コメントを入力…"
        className="mt-2 h-20 w-full resize-none rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-sm focus:border-sky-400 focus:outline-none"
      />
      <MentionPicker
        members={members}
        currentEmail={currentEmail}
        value={mentions}
        onChange={setMentions}
      />
      {create.error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{create.error.message}</p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={onDone}
          className="rounded px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          キャンセル
        </button>
        <button
          onClick={submit}
          disabled={!text.trim() || create.isPending}
          className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-40"
        >
          {create.isPending ? "作成中…" : "コメント"}
        </button>
      </div>
    </div>
  );
}

function ThreadCard({
  documentId,
  thread,
  members,
  currentEmail,
  nameOf,
  active,
  onFocus,
}: {
  documentId: string;
  thread: Thread;
  members: Member[];
  currentEmail: string;
  nameOf: (email: string) => string;
  active: boolean;
  onFocus?: (threadId: string) => void;
}) {
  const reply = useAddReply(documentId, thread.id);
  const setStatus = useSetThreadStatus(documentId);
  const [replyText, setReplyText] = useState("");
  const [replyMentions, setReplyMentions] = useState<string[]>([]);
  const resolved = thread.status === "resolved";
  const cardRef = useRef<HTMLDivElement>(null);

  // 本文側からフォーカスされたらカードを見える位置へスクロール。
  useEffect(() => {
    if (active) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  const submitReply = () => {
    if (!replyText.trim()) return;
    reply.mutate(
      { content: replyText.trim(), mentions: replyMentions.length ? replyMentions : undefined },
      {
        onSuccess: () => {
          setReplyText("");
          setReplyMentions([]);
        },
      },
    );
  };

  return (
    <div
      ref={cardRef}
      className={`rounded-md border p-3 ${
        active
          ? "border-amber-400 bg-amber-50 dark:bg-amber-900/40 ring-2 ring-amber-300"
          : resolved
            ? "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 opacity-80"
            : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onFocus?.(thread.id)}
          className="min-w-0 flex-1 text-left"
          title="本文の該当箇所へ移動"
        >
          <AnchorQuote text={thread.anchorText} />
        </button>
        {resolved && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
            解決済み
          </span>
        )}
      </div>

      <div className="space-y-2">
        {thread.comments.map((cm) => (
          <CommentItem
            key={cm.id}
            documentId={documentId}
            comment={cm}
            canEdit={cm.author === currentEmail}
            authorName={nameOf(cm.author)}
          />
        ))}
      </div>

      {!resolved && (
        <div className="mt-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="返信…"
            className="h-14 w-full resize-none rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-sm focus:border-slate-400 focus:outline-none"
          />
          <MentionPicker
            members={members}
            currentEmail={currentEmail}
            value={replyMentions}
            onChange={setReplyMentions}
          />
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-2">
        {!resolved && (
          <button
            onClick={submitReply}
            disabled={!replyText.trim() || reply.isPending}
            className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            返信
          </button>
        )}
        <button
          onClick={() => setStatus.mutate({ threadId: thread.id, reopen: resolved })}
          disabled={setStatus.isPending}
          className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
        >
          {resolved ? "再開" : "解決"}
        </button>
      </div>
    </div>
  );
}

function CommentItem({
  documentId,
  comment,
  canEdit,
  authorName,
}: {
  documentId: string;
  comment: Comment;
  canEdit: boolean;
  authorName: string;
}) {
  const editMut = useEditComment(documentId);
  const delMut = useDeleteComment(documentId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);

  const saveEdit = () => {
    if (!draft.trim()) return;
    editMut.mutate(
      { commentId: comment.id, content: draft.trim() },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <div className="rounded bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-sm">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{authorName}</span>
        <span className="text-[10px] text-slate-400">{fmtTime(comment.createdAt)}</span>
      </div>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-16 w-full resize-none rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-sm focus:border-slate-400 focus:outline-none"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button
              onClick={() => {
                setDraft(comment.content);
                setEditing(false);
              }}
              className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-200"
            >
              取消
            </button>
            <button
              onClick={saveEdit}
              disabled={editMut.isPending}
              className="rounded bg-slate-800 px-2 py-0.5 text-xs text-white hover:bg-slate-700 disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{comment.content}</p>
          {canEdit && (
            <div className="mt-1 flex gap-2 text-[11px] text-slate-400">
              <button onClick={() => setEditing(true)} className="hover:text-slate-700 dark:text-slate-200">
                編集
              </button>
              <button
                onClick={() => {
                  if (confirm("このコメントを削除しますか？")) delMut.mutate(comment.id);
                }}
                className="hover:text-red-600"
              >
                削除
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// メンバー選択式の @ メンション（折りたたみ）。
function MentionPicker({
  members,
  currentEmail,
  value,
  onChange,
}: {
  members: Member[];
  currentEmail: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const candidates = members.filter((m) => m.email !== currentEmail);
  if (candidates.length === 0) return null;

  const toggle = (email: string) =>
    onChange(value.includes(email) ? value.filter((e) => e !== email) : [...value, email]);

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-200"
      >
        @ メンション{value.length > 0 ? `（${value.length}）` : ""}
      </button>
      {open && (
        <div className="mt-1 flex flex-wrap gap-1">
          {candidates.map((m) => {
            const on = value.includes(m.email);
            return (
              <button
                key={m.email}
                onClick={() => toggle(m.email)}
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  on
                    ? "bg-sky-600 text-white"
                    : "border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                }`}
              >
                {m.displayName}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnchorQuote({ text }: { text: string }) {
  return (
    <blockquote className="border-l-2 border-amber-300 bg-amber-50/60 px-2 py-1 text-xs italic text-slate-500">
      {text.length > 120 ? text.slice(0, 120) + "…" : text}
    </blockquote>
  );
}

function fmtTime(s: string): string {
  return new Date(s).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
