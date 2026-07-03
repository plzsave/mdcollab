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
  aiSettings: AiSettings; // /api/state に束ね込み済み（往復削減）
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

// コメント（mentions は旧仕様のカンマ区切り文字列）。
export interface Comment {
  id: string;
  threadId: string;
  content: string;
  author: string;
  mentions: string | null;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

// AI 設定（秘密は真偽/スコープのみ・平文は返らない）。GET/PUT /api/ai/settings。
export interface AiSettings {
  provider: string | null;
  model: string | null;
  modelHard: string | null; // 難問昇格先（#84・null なら昇格なし）
  githubRepo: string | null;
  keys: Record<string, boolean>; // provider -> キー設定済みか
  githubPats: string[];
}

// 保存済みレビュー。GET /api/documents/:id/reviews。
export interface Review {
  id: string;
  documentId: string;
  provider: string;
  model: string;
  content: string;
  createdBy: string;
  createdAt: string;
  // コスト可観測性（Phase E）。旧レビューや usage 非対応プロバイダでは null。
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  toolsUsed: string | null; // JSON 文字列（string[]）
  truncated: boolean;
}

// スレッド（アンカー＋非削除コメント同梱）。GET /api/documents/:id/threads。
export interface Thread {
  id: string;
  documentId: string;
  anchorText: string;
  anchorBefore: string | null;
  anchorAfter: string | null;
  status: "open" | "resolved";
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  comments: Comment[];
}
