import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const scrapeOutputs = sqliteTable("scrape_outputs", {
  id: text("id").primaryKey(),
  taskId: text("task_id"),
  rootId: text("root_id"),
  outputDirectory: text("output_directory"),
  fileCount: integer("file_count").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const scrapeResults = sqliteTable("scrape_results", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  rootId: text("root_id").notNull(),
  relativePath: text("relative_path").notNull(),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  crawlerDataJson: text("crawler_data_json"),
  nfoRelativePath: text("nfo_relative_path"),
  outputRelativePath: text("output_relative_path"),
  manualUrl: text("manual_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const libraryEntries = sqliteTable(
  "library_entries",
  {
    id: text("id").primaryKey(),
    rootId: text("root_id").notNull(),
    rootRelativePath: text("root_relative_path").notNull(),
    fileName: text("file_name").notNull(),
    directory: text("directory").notNull(),
    size: integer("size").notNull().default(0),
    modifiedAt: integer("modified_at", { mode: "timestamp_ms" }),
    sourceTaskId: text("source_task_id"),
    scrapeOutputId: text("scrape_output_id"),
    title: text("title"),
    number: text("number"),
    actorsJson: text("actors_json").notNull().default("[]"),
    thumbnailPath: text("thumbnail_path"),
    lastKnownPath: text("last_known_path"),
    indexedAt: integer("indexed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({ rootPathKey: uniqueIndex("library_entries_root_path_idx").on(table.rootId, table.rootRelativePath) }),
);

export const schema = {
  mediaRoots,
  taskRecords,
  taskEvents,
  scanResults,
  scrapeOutputs,
  scrapeResults,
  libraryEntries,
};

export type MediaRootRow = typeof mediaRoots.$inferSelect;
export type InsertMediaRootRow = typeof mediaRoots.$inferInsert;
export type TaskRecordRow = typeof taskRecords.$inferSelect;
export type InsertTaskRecordRow = typeof taskRecords.$inferInsert;
export type TaskEventRow = typeof taskEvents.$inferSelect;
export type InsertTaskEventRow = typeof taskEvents.$inferInsert;
export type ScanResultRow = typeof scanResults.$inferSelect;
export type InsertScanResultRow = typeof scanResults.$inferInsert;
export type ScrapeOutputRow = typeof scrapeOutputs.$inferSelect;
export type InsertScrapeOutputRow = typeof scrapeOutputs.$inferInsert;
export type ScrapeResultRow = typeof scrapeResults.$inferSelect;
export type InsertScrapeResultRow = typeof scrapeResults.$inferInsert;
export type LibraryEntryRow = typeof libraryEntries.$inferSelect;
export type InsertLibraryEntryRow = typeof libraryEntries.$inferInsert;
