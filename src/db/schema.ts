// Drizzle スキーマ（Postgres 一本化）。移行計画 §6.1 を実体化。
// (A)フル移行は documents.storage_key、(B)ハイブリッドは drive_file_id を使う（両列を持つ）。
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const folders = pgTable("folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

export const members = pgTable("members", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("member"), // owner | member
  addedBy: text("added_by"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const statuses = pgTable("statuses", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const documents = pgTable("documents", {
  id: text("id").primaryKey(), // 新規採番（旧 Drive fileId は migration_source）
  folderId: text("folder_id").references(() => folders.id),
  title: text("title").notNull(),
  storageKey: text("storage_key"), // (A) R2/GCS 本体キー
  driveFileId: text("drive_file_id"), // (B) Drive 本体参照
  version: integer("version").notNull().default(1), // 楽観ロック（旧 lastUpdated 代替）
  statusId: text("status_id"),
  archived: boolean("archived").notNull().default(false),
  assignee: text("assignee"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  migrationSource: text("migration_source"), // 旧 Drive fileId（検証/ロールバック用）
});

export const threads = pgTable("threads", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id),
  anchorText: text("anchor_text").notNull(),
  anchorBefore: text("anchor_before"),
  anchorAfter: text("anchor_after"),
  status: text("status").notNull().default("open"), // open | resolved
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const comments = pgTable("comments", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id),
  content: text("content").notNull(),
  author: text("author").notNull(),
  mentions: text("mentions"), // 旧仕様: カンマ区切り。将来正規化（§6.1）
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted: boolean("deleted").notNull().default(false),
});

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  recipient: text("recipient").notNull(),
  type: text("type").notNull(),
  threadId: text("thread_id"),
  commentId: text("comment_id"),
  documentId: text("document_id"),
  documentName: text("document_name"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: createdAt(),
  message: text("message"),
});

export const reviews = pgTable("reviews", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  content: text("content").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

export const revisions = pgTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    createdBy: text("created_by").notNull(),
    content: text("content").notNull(),
    baseVersion: integer("base_version").notNull(),
    provider: text("provider"),
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("revisions_doc_user_uniq").on(t.documentId, t.createdBy)],
);

export const aiKeys = pgTable(
  "ai_keys",
  {
    email: text("email").notNull(),
    // API プロバイダのキー(provider="anthropic"等) と GitHub PAT(provider="github:<scope>") を兼ねる
    provider: text("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(), // 暗号化保存・平文非返却（§6.5）
  },
  (t) => [primaryKey({ columns: [t.email, t.provider] })],
);

// ユーザーごとの AI 設定（選択中プロバイダ/モデル・GitHub リポジトリ）。秘密は ai_keys 側。
export const aiSettings = pgTable("ai_settings", {
  email: text("email").primaryKey(),
  provider: text("provider"),
  model: text("model"),
  githubRepo: text("github_repo"),
});

// Drive 版履歴の代替（誤上書きの保険・§6.4）
export const documentVersions = pgTable(
  "document_versions",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    version: integer("version").notNull(),
    storageKey: text("storage_key"),
    driveFileId: text("drive_file_id"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.version] })],
);
