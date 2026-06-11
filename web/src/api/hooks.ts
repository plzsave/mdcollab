import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { AppState, Comment, DocumentFull, DocumentMeta, Thread } from "./types";

// 起動時ブートストラップ束。401=未ログイン / 403=非メンバー / 200=メンバー。
export function useAppState() {
  return useQuery({ queryKey: ["state"], queryFn: () => api.get<AppState>("/api/state") });
}

export function useFolderDocuments(folderId: string) {
  return useQuery({
    queryKey: ["folder-documents", folderId],
    queryFn: () => api.get<DocumentMeta[]>(`/api/folders/${folderId}/documents`),
  });
}

export function useDocument(documentId: string) {
  return useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api.get<DocumentFull>(`/api/documents/${documentId}`),
  });
}

// 文書保存（If-Match: version → 409 で楽観ロック衝突）。
// force=true のときはサーバ現行 version に対して上書き（衝突を承知で再保存）。
export function useSaveDocument(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { content: string; baseVersion: number }) =>
      api.put<{ id: string; version: number }>(
        `/api/documents/${documentId}`,
        { content: vars.content },
        { "If-Match": String(vars.baseVersion) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document", documentId] });
      qc.invalidateQueries({ queryKey: ["folder-documents"] });
    },
  });
}

// ── スレッド / コメント ─────────────────────────────────────────────
// すべて queryKey ["threads", documentId] を共有し、変更系は同キーを無効化して再取得。

export function useThreads(documentId: string) {
  return useQuery({
    queryKey: ["threads", documentId],
    queryFn: () => api.get<Thread[]>(`/api/documents/${documentId}/threads`),
  });
}

export function useCreateThread(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      anchorText: string;
      anchorBefore?: string;
      anchorAfter?: string;
      firstComment: string;
      mentions?: string[];
    }) => api.post<Thread>(`/api/documents/${documentId}/threads`, vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads", documentId] }),
  });
}

export function useAddReply(documentId: string, threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { content: string; mentions?: string[] }) =>
      api.post<Comment>(`/api/threads/${threadId}/comments`, vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads", documentId] }),
  });
}

// 解決 / 再開（reopen=true で再開エンドポイントへ）。
export function useSetThreadStatus(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { threadId: string; reopen?: boolean }) =>
      api.post<{ ok: boolean }>(`/api/threads/${vars.threadId}/${vars.reopen ? "reopen" : "resolve"}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads", documentId] }),
  });
}

export function useEditComment(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { commentId: string; content: string }) =>
      api.patch<Comment>(`/api/comments/${vars.commentId}`, { content: vars.content }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads", documentId] }),
  });
}

export function useDeleteComment(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => api.delete<{ ok: boolean }>(`/api/comments/${commentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads", documentId] }),
  });
}

// logout は POST。完了後は state を無効化して未ログイン画面へ戻す。
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/auth/logout"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["state"] }),
  });
}
