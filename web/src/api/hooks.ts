import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { AppState, DocumentFull, DocumentMeta } from "./types";

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

// logout は POST。完了後は state を無効化して未ログイン画面へ戻す。
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/auth/logout"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["state"] }),
  });
}
