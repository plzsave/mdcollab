// バックエンド(src/db/schema.ts, src/routes/*) のレスポンス形に対応する型。

export type Role = "owner" | "member";

export interface Member {
  email: string;
  displayName: string;
  role: Role;
  addedBy: string | null;
  addedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export interface Status {
  id: string;
  label: string;
  sortOrder: number;
}

export interface Notification {
  id: string;
  recipient: string;
  type: string;
  threadId: string | null;
  commentId: string | null;
  documentId: string | null;
  documentName: string | null;
  isRead: boolean;
  createdAt: string;
  message: string | null;
}

export interface AppState {
  currentUser: { email: string; name: string | null; role: Role };
  members: Member[];
  folders: Folder[];
  statuses: Status[];
  notifications: Notification[];
}

// 本文なしの軽量メタ（GET /api/folders/:id/documents）。
export interface DocumentMeta {
  id: string;
  folderId: string | null;
  title: string;
  version: number;
  statusId: string | null;
  archived: boolean;
  assignee: string | null;
  updatedAt: string;
}

// 本文込み（GET /api/documents/:id）。
export interface DocumentFull extends DocumentMeta {
  content: string;
}
