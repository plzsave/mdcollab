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
  // 検索用の本文コピー（search_docs の全文検索用）。本体は R2/GCS だが、検索のため Postgres に
  // 同期コピーを持つ。保存時に同期され、既存文書は次回保存時に埋まる（backfill は別途）。
  body: text("body"),
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
  // コスト可観測性（Phase E）。usage は旧レビューや usage 非返却プロバイダでは null。
  // inputTokens は「キャッシュ未ヒットの新規入力」。総入力 = input + cacheRead + cacheWrite。
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheWriteTokens: integer("cache_write_tokens"),
  toolsUsed: text("tools_used"), // 使用ツールの JSON 文字列（string[]）
  truncated: boolean("truncated").notNull().default(false),
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
    // コスト可観測性（Phase H・reviews と同じ意味）。usage 非対応プロバイダや旧行では null。
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    toolsUsed: text("tools_used"), // 使用ツールの JSON 文字列（string[]）
    truncated: boolean("truncated").notNull().default(false),
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

// AI レビュー機能の運用イベント（追記専用・本文は含めない＝content-free）。
// 既存テーブルでは取りこぼす信号を貯める: 指摘のスレッド化数 / 無視され置換された数（superseded）/
// AI スレッドの解決数。採用率・ノイズ率の母数を正確にするため（Tier 1）。
export const aiReviewEvents = pgTable("ai_review_events", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(), // 不透明 ID（本文ではない）。doc 削除に追従しないよう FK は張らない
  actor: text("actor").notNull(), // 操作者の email（本文・指摘文は保存しない）
  action: text("action").notNull(), // threads_created | threads_superseded | thread_resolved
  count: integer("count"), // 件数（created/superseded）。thread_resolved は 1
  createdAt: createdAt(),
});

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
