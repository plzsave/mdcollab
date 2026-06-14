import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import {
  useCreateDocument,
  useDeleteFolder,
  useImportDocuments,
  useRenameFolder,
} from "../api/hooks";
import { useConfirm } from "./ui/confirm";
import { useToast } from "./ui/toast";

// フォルダ操作（名前変更・削除）と文書作成・Markdown 取込をまとめたツールバー。
export function FolderToolbar({
  folderId,
  folderName,
  docCount,
}: {
  folderId: string;
  folderName: string;
  docCount: number;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const rename = useRenameFolder();
  const delFolder = useDeleteFolder();
  const createDoc = useCreateDocument(folderId);
  const importDocs = useImportDocuments(folderId);
  const fileRef = useRef<HTMLInputElement>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(folderName);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const submitRename = () => {
    if (!nameDraft.trim()) return;
    rename.mutate(
      { id: folderId, name: nameDraft.trim() },
      { onSuccess: () => setEditingName(false) },
    );
  };

  const submitCreate = () => {
    if (!title.trim()) return;
    createDoc.mutate(
      { title: title.trim() },
      {
        onSuccess: (doc) => {
          setTitle("");
          setCreating(false);
          navigate({ to: "/documents/$documentId", params: { documentId: doc.id } });
        },
      },
    );
  };

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setImportMsg(null);
    const files = await Promise.all(
      [...list].map(async (f) => ({ name: f.name, content: await f.text() })),
    );
    importDocs.mutate(files, {
      onSuccess: (results) => {
        const ok = results.filter((r) => r.ok).length;
        const ng = results.length - ok;
        setImportMsg(`取込: 成功 ${ok}${ng ? ` / 失敗 ${ng}` : ""}`);
      },
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {editingName ? (
          <>
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xl font-bold text-slate-800 dark:text-slate-100 focus:border-slate-400 focus:outline-none"
            />
            <button onClick={submitRename} className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 dark:text-slate-100">
              保存
            </button>
            <button
              onClick={() => {
                setNameDraft(folderName);
                setEditingName(false);
              }}
              className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 dark:text-slate-200"
            >
              取消
            </button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{folderName}</h1>
            <button
              onClick={() => {
                setNameDraft(folderName);
                setEditingName(true);
              }}
              className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 dark:text-slate-200"
            >
              名前変更
            </button>
            <button
              onClick={async () => {
                if (docCount > 0) return;
                const ok = await confirm({
                  title: "フォルダを削除しますか？",
                  message: `「${folderName}」を削除します。`,
                  confirmLabel: "削除",
                  danger: true,
                });
                if (!ok) return;
                delFolder.mutate(folderId, {
                  onSuccess: () => {
                    toast.success("フォルダを削除しました");
                    navigate({ to: "/" });
                  },
                  onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
                });
              }}
              disabled={docCount > 0}
              title={docCount > 0 ? "文書が残っているフォルダは削除できません" : ""}
              className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-40"
            >
              削除
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setCreating((v) => !v)}
          className="rounded-md bg-slate-800 dark:bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:hover:bg-slate-600"
        >
          新規文書
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importDocs.isPending}
          className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:border-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-100 dark:text-slate-100 disabled:opacity-40"
        >
          {importDocs.isPending ? "取込中…" : "インポート"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          multiple
          onChange={(e) => onFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {creating && (
        <div className="flex w-full items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="文書タイトル"
            className="flex-1 rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
          />
          <button
            onClick={submitCreate}
            disabled={!title.trim() || createDoc.isPending}
            className="rounded bg-slate-800 dark:bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-40"
          >
            作成して開く
          </button>
        </div>
      )}

      {(rename.error || delFolder.error || createDoc.error || importDocs.error) && (
        <p className="w-full text-xs text-red-600 dark:text-red-400">
          {errMsg(rename.error ?? delFolder.error ?? createDoc.error ?? importDocs.error)}
        </p>
      )}
      {importMsg && <p className="w-full text-xs text-emerald-600">{importMsg}</p>}
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "操作に失敗しました";
}
