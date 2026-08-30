import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const mediaRoots = sqliteTable("media_roots", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  hostPath: text("host_path").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const scanTasks = sqliteTable(
  "scan_tasks",
  {
    id: text("id").primaryKey(),
    rootId: text("root_id").notNull(),
    status: text("status").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    errorMessage: text("error_message"),
    videoCount: integer("video_count").notNull().default(0),
    directoryCount: integer("directory_count").notNull().default(0),
  },
  (table) => [
    index("scan_tasks_queue_idx").on(table.status, table.createdAt),
    index("scan_tasks_created_at_idx").on(table.createdAt),
  ],
);

export const scanTaskEvents = sqliteTable(
  "scan_task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("scan_task_events_task_created_at_idx").on(table.taskId, table.createdAt)],
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
    disposition: text("disposition").$type<"completed" | "failed" | "stopped" | "interrupted">(),
    errorMessage: text("error_message"),
  },
  (table) => [
    check("scrape_runs_execution_mode_check", sql`${table.executionMode} in ('single', 'batch')`),
    check(
      "scrape_runs_disposition_check",
      sql`${table.disposition} is null or ${table.disposition} in ('completed', 'failed', 'stopped', 'interrupted')`,
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
    attemptId: text("attempt_id")
      .notNull()
      .references(() => scrapeAttempts.id, { onDelete: "cascade" }),
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
    check("scrape_item_outcomes_outcome_check", sql`${table.outcome} in ('success', 'failed', 'skipped')`),
    check("scrape_item_outcomes_size_check", sql`${table.size} >= 0`),
    uniqueIndex("scrape_item_outcomes_attempt_idx").on(table.attemptId),
  ],
);

export const scrapeAttempts = sqliteTable(
  "scrape_attempts",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => scrapeRunItems.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    admittedAt: integer("admitted_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("scrape_attempts_attempt_check", sql`${table.attempt} >= 1`),
    uniqueIndex("scrape_attempts_item_attempt_idx").on(table.itemId, table.attempt),
  ],
);

export const publicationJournal = sqliteTable(
  "publication_journal",
  {
    operationId: text("operation_id").primaryKey(),
    operationType: text("operation_type").notNull(),
    state: text("state").$type<"pending" | "committed">().notNull(),
    manifestJson: text("manifest_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [check("publication_journal_state_check", sql`${table.state} in ('pending', 'committed')`)],
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
    itemId: text("item_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" }),
    rootId: text("root_id")
      .notNull()
      .references(() => mediaRoots.id, { onDelete: "restrict" }),
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
    itemId: text("item_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    uri: text("uri").notNull(),
    rootId: text("root_id").references(() => mediaRoots.id, { onDelete: "restrict" }),
    relativePath: text("relative_path"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("library_item_assets_root_path_check", sql`(${table.rootId} is null) = (${table.relativePath} is null)`),
    index("library_item_assets_item_idx").on(table.itemId),
  ],
);

export const libraryRepairIssues = sqliteTable(
  "library_repair_issues",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id").notNull(),
    operationType: text("operation_type").$type<"scrape" | "maintenance">().notNull(),
    rootId: text("root_id").notNull(),
    relativePath: text("relative_path").notNull(),
    errorMessage: text("error_message").notNull(),
    detectedAt: integer("detected_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check("library_repair_issues_operation_type_check", sql`${table.operationType} in ('scrape', 'maintenance')`),
    uniqueIndex("library_repair_issues_operation_path_idx").on(table.operationId, table.rootId, table.relativePath),
    index("library_repair_issues_unresolved_idx").on(table.resolvedAt, table.detectedAt),
    index("library_repair_issues_operation_idx").on(table.operationId, table.operationType),
  ],
);

export const schema = {
  mediaRoots,
  scanTasks,
  scanTaskEvents,
  scanResults,
  scrapeRuns,
  scrapeRunItems,
  scrapeAttempts,
  scrapeItemOutcomes,
  publicationJournal,
  libraryRepairIssues,
  libraryItems,
  libraryItemFiles,
  libraryItemAssets,
};

export type MediaRootRow = typeof mediaRoots.$inferSelect;
export type InsertMediaRootRow = typeof mediaRoots.$inferInsert;
export type ScanTaskRow = typeof scanTasks.$inferSelect;
export type InsertScanTaskRow = typeof scanTasks.$inferInsert;
export type ScanTaskEventRow = typeof scanTaskEvents.$inferSelect;
export type InsertScanTaskEventRow = typeof scanTaskEvents.$inferInsert;
export type ScanResultRow = typeof scanResults.$inferSelect;
export type InsertScanResultRow = typeof scanResults.$inferInsert;
export type ScrapeRunRow = typeof scrapeRuns.$inferSelect;
export type InsertScrapeRunRow = typeof scrapeRuns.$inferInsert;
export type ScrapeRunItemRow = typeof scrapeRunItems.$inferSelect;
export type InsertScrapeRunItemRow = typeof scrapeRunItems.$inferInsert;
export type ScrapeAttemptRow = typeof scrapeAttempts.$inferSelect;
export type InsertScrapeAttemptRow = typeof scrapeAttempts.$inferInsert;
export type ScrapeItemOutcomeRow = typeof scrapeItemOutcomes.$inferSelect;
export type InsertScrapeItemOutcomeRow = typeof scrapeItemOutcomes.$inferInsert;
export type PublicationJournalRow = typeof publicationJournal.$inferSelect;
export type InsertPublicationJournalRow = typeof publicationJournal.$inferInsert;
export type LibraryItemRow = typeof libraryItems.$inferSelect;
export type InsertLibraryItemRow = typeof libraryItems.$inferInsert;
export type LibraryItemFileRow = typeof libraryItemFiles.$inferSelect;
export type InsertLibraryItemFileRow = typeof libraryItemFiles.$inferInsert;
export type LibraryItemAssetRow = typeof libraryItemAssets.$inferSelect;
export type InsertLibraryItemAssetRow = typeof libraryItemAssets.$inferInsert;
export type LibraryRepairIssueRow = typeof libraryRepairIssues.$inferSelect;
export type InsertLibraryRepairIssueRow = typeof libraryRepairIssues.$inferInsert;
