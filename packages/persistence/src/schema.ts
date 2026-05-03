import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mediaRoots = sqliteTable("media_roots", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  hostPath: text("host_path").notNull(),
  rootType: text("root_type").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const taskRecords = sqliteTable("task_records", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  rootId: text("root_id").notNull(),
  status: text("status").notNull(),
  summary: text("summary"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  errorMessage: text("error_message"),
  videoCount: integer("video_count").notNull().default(0),
  directoryCount: integer("directory_count").notNull().default(0),
});

export const taskEvents = sqliteTable("task_events", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const scanResults = sqliteTable("scan_results", {
  taskId: text("task_id").notNull(),
  rootId: text("root_id").notNull(),
  relativePath: text("relative_path").notNull(),
  size: integer("size").notNull(),
  modifiedAt: integer("modified_at", { mode: "timestamp_ms" }),
});

export const schema = {
  mediaRoots,
  taskRecords,
  taskEvents,
  scanResults,
};

export type MediaRootRow = typeof mediaRoots.$inferSelect;
export type InsertMediaRootRow = typeof mediaRoots.$inferInsert;
export type TaskRecordRow = typeof taskRecords.$inferSelect;
export type InsertTaskRecordRow = typeof taskRecords.$inferInsert;
export type TaskEventRow = typeof taskEvents.$inferSelect;
export type InsertTaskEventRow = typeof taskEvents.$inferInsert;
export type ScanResultRow = typeof scanResults.$inferSelect;
export type InsertScanResultRow = typeof scanResults.$inferInsert;
