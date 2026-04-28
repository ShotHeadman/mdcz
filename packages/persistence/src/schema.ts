import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mediaRoots = sqliteTable("media_roots", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  hostPath: text("host_path").notNull(),
  rootType: text("root_type").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const taskRecords = sqliteTable("task_records", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  summary: text("summary"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  errorMessage: text("error_message"),
});

export const schema = {
  mediaRoots,
  taskRecords,
};

export type MediaRootRow = typeof mediaRoots.$inferSelect;
export type InsertMediaRootRow = typeof mediaRoots.$inferInsert;
export type TaskRecordRow = typeof taskRecords.$inferSelect;
export type InsertTaskRecordRow = typeof taskRecords.$inferInsert;
