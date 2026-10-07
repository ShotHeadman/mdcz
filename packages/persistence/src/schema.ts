import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const mediaRoots = sqliteTable(
  "media_roots",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    hostPath: text("host_path").notNull(),
    realPath: text("real_path"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("media_roots_host_path_idx").on(table.hostPath)],
);

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

export const mediaLibraries = sqliteTable("media_libraries", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourcePath: text("source_path").notNull(),
  outputPath: text("output_path").notNull(),
  folderTemplate: text("folder_template").notNull(),
  fileTemplate: text("file_template").notNull(),
  placement: text("placement").notNull(),
  automation: text("automation").notNull(),
  discovery: text("discovery").notNull(),
  cloudPath: text("cloud_path").notNull(),
  scanIntervalMinutes: integer("scan_interval_minutes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const scrapeRuns = sqliteTable(
  "scrape_runs",
  {
    id: text("id").primaryKey(),
    previousRunId: text("previous_run_id"),
    libraryId: text("library_id"),
    rootId: text("root_id").notNull(),
    outputRootId: text("output_root_id"),
    outputRelativeDirectory: text("output_relative_directory"),
    executionMode: text("execution_mode").$type<"single" | "batch">().notNull(),
    directoryScopeJson: text("directory_scope_json"),
    manifestJson: text("manifest_json"),
    manifestFixedAt: integer("manifest_fixed_at", { mode: "timestamp_ms" }),
    discoveryJson: text("discovery_json"),
    totalItems: integer("total_items").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    totalBytes: integer("total_bytes").notNull().default(0),
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

export const libraryItems = sqliteTable(
  "library_items",
  {
    id: text("id").primaryKey(),
    mediaIdentity: text("media_identity"),
    crawlerDataJson: text("crawler_data_json"),
    title: text("title"),
    number: text("number"),
    actorsJson: text("actors_json").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastRefreshedAt: integer("last_refreshed_at", { mode: "timestamp_ms" }),
    hiddenFromRecentAt: integer("hidden_from_recent_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("library_items_created_at_idx").on(table.createdAt, table.id)],
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
    entryIdentity: text("entry_identity"),
    /** Where a hardlink or copy came from; that source stays on disk and must not be scraped again. */
    retainedSourceIdentity: text("retained_source_identity"),
    fileName: text("file_name").notNull(),
    directory: text("directory").notNull(),
    size: integer("size").notNull().default(0),
    modifiedAt: integer("modified_at", { mode: "timestamp_ms" }),
    lastKnownPath: text("last_known_path"),
    partNumber: integer("part_number"),
    partSuffix: text("part_suffix"),
    resolution: text("resolution"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("library_item_files_root_path_idx").on(table.rootId, table.rootRelativePath),
    uniqueIndex("library_item_files_entry_identity_idx").on(table.entryIdentity),
    index("library_item_files_retained_source_idx").on(table.retainedSourceIdentity),
    check("library_item_files_part_number_check", sql`${table.partNumber} is null or ${table.partNumber} >= 1`),
  ],
);

export const libraryItemAssets = sqliteTable(
  "library_item_assets",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" }),
    fileId: text("file_id"),
    kind: text("kind").notNull(),
    uri: text("uri").notNull(),
    rootId: text("root_id").references(() => mediaRoots.id, { onDelete: "restrict" }),
    relativePath: text("relative_path"),
    published: integer("published", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("library_item_assets_root_path_check", sql`(${table.rootId} is null) = (${table.relativePath} is null)`),
    check("library_item_assets_scope_check", sql`(${table.kind} = 'subtitle') = (${table.fileId} is not null)`),
    foreignKey({
      columns: [table.itemId, table.fileId],
      foreignColumns: [libraryItemFiles.itemId, libraryItemFiles.id],
      name: "library_item_assets_item_file_fk",
    }).onDelete("cascade"),
    index("library_item_assets_item_idx").on(table.itemId),
    index("library_item_assets_file_idx").on(table.fileId),
    index("library_item_assets_output_idx").on(table.rootId, table.relativePath),
  ],
);

// The latest outcome per movie and site; `data_json` keeps the last answer the site gave about the movie.
export const siteResults = sqliteTable(
  "site_results",
  {
    number: text("number").notNull(),
    site: text("site").notNull(),
    status: text("status").$type<"success" | "failed" | "skipped">().notNull(),
    reason: text("reason"),
    skipReason: text("skip_reason"),
    detail: text("detail"),
    httpStatus: integer("http_status"),
    elapsedMs: integer("elapsed_ms").notNull(),
    dataJson: text("data_json"),
    sourceUrl: text("source_url"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.number, table.site] }),
    check("site_results_status_check", sql`${table.status} in ('success', 'failed', 'skipped')`),
  ],
);

export const libraryWatchSnapshots = sqliteTable("library_watch_snapshots", {
  libraryId: text("library_id")
    .primaryKey()
    .references(() => mediaLibraries.id, { onDelete: "cascade" }),
  fileKeysJson: text("file_keys_json").notNull(),
});

export const PENDING_KINDS = ["no_number", "not_found", "ambiguous", "failed", "uncensored", "new_file"] as const;
export type PendingKind = (typeof PENDING_KINDS)[number];

// One entry per source file that needs a person: it failed, could not be attributed, or waits for a manual scrape.
export const pendingItems = sqliteTable(
  "pending_items",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<PendingKind>().notNull(),
    rootId: text("root_id")
      .notNull()
      .references(() => mediaRoots.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    libraryId: text("library_id").references(() => mediaLibraries.id, { onDelete: "set null" }),
    movieId: text("movie_id").references(() => libraryItems.id, { onDelete: "cascade" }),
    number: text("number"),
    detail: text("detail"),
    candidatesJson: text("candidates_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("pending_items_file_idx").on(table.rootId, table.relativePath),
    index("pending_items_updated_at_idx").on(table.updatedAt),
    check(
      "pending_items_kind_check",
      sql`${table.kind} in ('no_number', 'not_found', 'ambiguous', 'failed', 'uncensored', 'new_file')`,
    ),
  ],
);

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
});

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
});

export const schema = {
  mediaRoots,
  mediaLibraries,
  scanTasks,
  scanTaskEvents,
  scanResults,
  scrapeRuns,
  libraryItems,
  libraryItemFiles,
  libraryItemAssets,
  siteResults,
  libraryWatchSnapshots,
  pendingItems,
  apiKeys,
  authSessions,
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
export type LibraryItemRow = typeof libraryItems.$inferSelect;
export type InsertLibraryItemRow = typeof libraryItems.$inferInsert;
export type LibraryItemFileRow = typeof libraryItemFiles.$inferSelect;
export type InsertLibraryItemFileRow = typeof libraryItemFiles.$inferInsert;
export type LibraryItemAssetRow = typeof libraryItemAssets.$inferSelect;
export type SiteResultRow = typeof siteResults.$inferSelect;
export type MediaLibraryRow = typeof mediaLibraries.$inferSelect;
export type PendingItemRow = typeof pendingItems.$inferSelect;
export type InsertLibraryItemAssetRow = typeof libraryItemAssets.$inferInsert;
