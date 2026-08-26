import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const mediaRoots = sqliteTable(
  "media_roots",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    hostPath: text("host_path").notNull(),
    rootType: text("root_type").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("media_roots_state_idx").on(table.deleted, table.enabled)],
);

export const taskRecords = sqliteTable(
  "task_records",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<"scan">().notNull(),
    rootId: text("root_id").notNull(),
    status: text("status").notNull(),
    executionVersion: integer("execution_version").notNull().default(0),
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    errorMessage: text("error_message"),
    videoCount: integer("video_count").notNull().default(0),
    directoryCount: integer("directory_count").notNull().default(0),
  },
  (table) => [
    index("task_records_queue_idx").on(table.kind, table.status, table.createdAt),
    index("task_records_kind_created_at_idx").on(table.kind, table.createdAt),
  ],
);

export const taskEvents = sqliteTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("task_events_task_created_at_idx").on(table.taskId, table.createdAt)],
);

export const scanResults = sqliteTable(
  "scan_results",
  {
    taskId: text("task_id").notNull(),
    rootId: text("root_id").notNull(),
    relativePath: text("relative_path").notNull(),
    size: integer("size").notNull(),
    modifiedAt: integer("modified_at", { mode: "timestamp_ms" }),
  },
  (table) => [uniqueIndex("scan_results_task_root_path_idx").on(table.taskId, table.rootId, table.relativePath)],
);

export const scrapeRuns = sqliteTable(
  "scrape_runs",
  {
    id: text("id").primaryKey(),
    rootId: text("root_id").notNull(),
    outputRootId: text("output_root_id"),
    executionMode: text("execution_mode").$type<"single" | "batch">().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    disposition: text("disposition").$type<"completed" | "failed" | "stopped">(),
    errorMessage: text("error_message"),
  },
  (table) => [
    check("scrape_runs_execution_mode_check", sql`${table.executionMode} in ('single', 'batch')`),
    check(
      "scrape_runs_disposition_check",
      sql`${table.disposition} is null or ${table.disposition} in ('completed', 'failed', 'stopped')`,
    ),
    index("scrape_runs_created_at_idx").on(table.createdAt),
  ],
);

export const scrapeRunItems = sqliteTable(
  "scrape_run_items",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => scrapeRuns.id),
    ordinal: integer("ordinal").notNull(),
    rootId: text("root_id").notNull(),
    relativePath: text("relative_path").notNull(),
    manualUrl: text("manual_url"),
    uncensoredChoice: text("uncensored_choice").$type<"umr" | "leak" | "uncensored">(),
  },
  (table) => [
    check("scrape_run_items_ordinal_check", sql`${table.ordinal} >= 0`),
    check(
      "scrape_run_items_uncensored_choice_check",
      sql`${table.uncensoredChoice} is null or ${table.uncensoredChoice} in ('umr', 'leak', 'uncensored')`,
    ),
    uniqueIndex("scrape_run_items_run_ordinal_idx").on(table.runId, table.ordinal),
    uniqueIndex("scrape_run_items_run_root_path_idx").on(table.runId, table.rootId, table.relativePath),
  ],
);

export const scrapeItemOutcomes = sqliteTable(
  "scrape_item_outcomes",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => scrapeRunItems.id),
    attempt: integer("attempt").notNull(),
    outcome: text("outcome").$type<"success" | "failed" | "skipped">().notNull(),
    errorMessage: text("error_message"),
    crawlerDataJson: text("crawler_data_json"),
    nfoRootId: text("nfo_root_id"),
    nfoRelativePath: text("nfo_relative_path"),
    outputRootId: text("output_root_id"),
    outputRelativePath: text("output_relative_path"),
    uncensoredAmbiguous: integer("uncensored_ambiguous", { mode: "boolean" }).notNull().default(false),
    size: integer("size").notNull().default(0),
    modifiedAt: integer("modified_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("scrape_item_outcomes_attempt_check", sql`${table.attempt} > 0`),
    check("scrape_item_outcomes_outcome_check", sql`${table.outcome} in ('success', 'failed', 'skipped')`),
    check("scrape_item_outcomes_size_check", sql`${table.size} >= 0`),
    uniqueIndex("scrape_item_outcomes_item_attempt_idx").on(table.itemId, table.attempt),
  ],
);

export const libraryItems = sqliteTable(
  "library_items",
  {
    id: text("id").primaryKey(),
    mediaIdentity: text("media_identity"),
    crawlerDataJson: text("crawler_data_json"),
    sourceRunId: text("source_run_id"),
    sourceOutcomeId: text("source_outcome_id"),
    title: text("title"),
    number: text("number"),
    actorsJson: text("actors_json").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastRefreshedAt: integer("last_refreshed_at", { mode: "timestamp_ms" }),
    hiddenFromRecentAt: integer("hidden_from_recent_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("library_items_source_run_idx").on(table.sourceRunId),
    index("library_items_created_at_idx").on(table.createdAt, table.id),
  ],
);

export const libraryItemFiles = sqliteTable(
  "library_item_files",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull(),
    rootId: text("root_id").notNull(),
    rootRelativePath: text("root_relative_path").notNull(),
    fileName: text("file_name").notNull(),
    directory: text("directory").notNull(),
    size: integer("size").notNull().default(0),
    modifiedAt: integer("modified_at", { mode: "timestamp_ms" }),
    lastKnownPath: text("last_known_path"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("library_item_files_root_path_idx").on(table.rootId, table.rootRelativePath),
    index("library_item_files_item_idx").on(table.itemId),
  ],
);

export const libraryItemAssets = sqliteTable(
  "library_item_assets",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull(),
    kind: text("kind").notNull(),
    uri: text("uri").notNull(),
    rootId: text("root_id"),
    relativePath: text("relative_path"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("library_item_assets_item_idx").on(table.itemId)],
);

export const schema = {
  mediaRoots,
  taskRecords,
  taskEvents,
  scanResults,
  scrapeRuns,
  scrapeRunItems,
  scrapeItemOutcomes,
  libraryItems,
  libraryItemFiles,
  libraryItemAssets,
};

export type MediaRootRow = typeof mediaRoots.$inferSelect;
export type InsertMediaRootRow = typeof mediaRoots.$inferInsert;
export type TaskRecordRow = typeof taskRecords.$inferSelect;
export type InsertTaskRecordRow = typeof taskRecords.$inferInsert;
export type TaskEventRow = typeof taskEvents.$inferSelect;
export type InsertTaskEventRow = typeof taskEvents.$inferInsert;
export type ScanResultRow = typeof scanResults.$inferSelect;
export type InsertScanResultRow = typeof scanResults.$inferInsert;
export type ScrapeRunRow = typeof scrapeRuns.$inferSelect;
export type InsertScrapeRunRow = typeof scrapeRuns.$inferInsert;
export type ScrapeRunItemRow = typeof scrapeRunItems.$inferSelect;
export type InsertScrapeRunItemRow = typeof scrapeRunItems.$inferInsert;
export type ScrapeItemOutcomeRow = typeof scrapeItemOutcomes.$inferSelect;
export type InsertScrapeItemOutcomeRow = typeof scrapeItemOutcomes.$inferInsert;
export type LibraryItemRow = typeof libraryItems.$inferSelect;
export type InsertLibraryItemRow = typeof libraryItems.$inferInsert;
export type LibraryItemFileRow = typeof libraryItemFiles.$inferSelect;
export type InsertLibraryItemFileRow = typeof libraryItemFiles.$inferInsert;
export type LibraryItemAssetRow = typeof libraryItemAssets.$inferSelect;
export type InsertLibraryItemAssetRow = typeof libraryItemAssets.$inferInsert;
