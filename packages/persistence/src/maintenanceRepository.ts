import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import {
  type MaintenanceApplyLogRow,
  type MaintenancePreviewRow,
  maintenanceApplyLog,
  maintenancePreviews,
} from "./schema";

export type MaintenancePreviewStatus = "ready" | "blocked" | "applied" | "failed";
export type MaintenanceApplyStatus = "success" | "failed" | "skipped";

export interface MaintenancePreviewRecord {
  id: string;
  taskId: string;
  rootId: string;
  relativePath: string;
  presetId: string;
  status: MaintenancePreviewStatus;
  error: string | null;
  fieldDiffsJson: string;
  unchangedFieldDiffsJson: string;
  pathDiffJson: string | null;
  proposedCrawlerDataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertMaintenancePreviewInput {
  id?: string;
  taskId: string;
  rootId: string;
  relativePath: string;
  presetId: string;
  status: MaintenancePreviewStatus;
  error?: string | null;
  fieldDiffsJson?: string;
  unchangedFieldDiffsJson?: string;
  pathDiffJson?: string | null;
  proposedCrawlerDataJson?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MaintenanceApplyLogRecord {
  id: string;
  taskId: string;
  previewId: string;
  rootId: string;
  relativePath: string;
  presetId: string;
  status: MaintenanceApplyStatus;
  error: string | null;
  appliedAt: Date;
}

export interface AddMaintenanceApplyLogInput {
  id?: string;
  taskId: string;
  previewId: string;
  rootId: string;
  relativePath: string;
  presetId: string;
  status: MaintenanceApplyStatus;
  error?: string | null;
  appliedAt?: Date;
}

const toPreviewRecord = (row: MaintenancePreviewRow): MaintenancePreviewRecord => ({
  id: row.id,
  taskId: row.taskId,
  rootId: row.rootId,
  relativePath: row.relativePath,
  presetId: row.presetId,
  status: row.status as MaintenancePreviewStatus,
  error: row.errorMessage,
  fieldDiffsJson: row.fieldDiffsJson,
  unchangedFieldDiffsJson: row.unchangedFieldDiffsJson,
  pathDiffJson: row.pathDiffJson,
  proposedCrawlerDataJson: row.proposedCrawlerDataJson,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toApplyLogRecord = (row: MaintenanceApplyLogRow): MaintenanceApplyLogRecord => ({
  id: row.id,
  taskId: row.taskId,
  previewId: row.previewId,
  rootId: row.rootId,
  relativePath: row.relativePath,
  presetId: row.presetId,
  status: row.status as MaintenanceApplyStatus,
  error: row.errorMessage,
  appliedAt: row.appliedAt,
});

export class MaintenanceRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  async upsertPreview(input: UpsertMaintenancePreviewInput): Promise<MaintenancePreviewRecord> {
    const id = input.id ?? randomUUID();
    const now = new Date();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;
    this.database.db
      .insert(maintenancePreviews)
      .values({
        id,
        taskId: input.taskId,
        rootId: input.rootId,
        relativePath: input.relativePath,
        presetId: input.presetId,
        status: input.status,
        errorMessage: input.error ?? null,
        fieldDiffsJson: input.fieldDiffsJson ?? "[]",
        unchangedFieldDiffsJson: input.unchangedFieldDiffsJson ?? "[]",
        pathDiffJson: input.pathDiffJson ?? null,
        proposedCrawlerDataJson: input.proposedCrawlerDataJson ?? null,
        createdAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: maintenancePreviews.id,
        set: {
          status: input.status,
          errorMessage: input.error ?? null,
          fieldDiffsJson: input.fieldDiffsJson ?? "[]",
          unchangedFieldDiffsJson: input.unchangedFieldDiffsJson ?? "[]",
          pathDiffJson: input.pathDiffJson ?? null,
          proposedCrawlerDataJson: input.proposedCrawlerDataJson ?? null,
          updatedAt,
        },
      })
      .run();
    return await this.getPreview(id);
  }

  async getPreview(id: string): Promise<MaintenancePreviewRecord> {
    const row = this.database.db
      .select()
      .from(maintenancePreviews)
      .where(eq(maintenancePreviews.id, id))
      .limit(1)
      .get();
    if (!row) {
      throw new Error(`Maintenance preview not found: ${id}`);
    }
    return toPreviewRecord(row);
  }

  async listPreviews(taskId: string): Promise<MaintenancePreviewRecord[]> {
    const rows = this.database.db
      .select()
      .from(maintenancePreviews)
      .where(eq(maintenancePreviews.taskId, taskId))
      .orderBy(maintenancePreviews.relativePath)
      .all();
    return rows.map(toPreviewRecord);
  }

  async deletePreviewsForTask(taskId: string): Promise<void> {
    this.database.db.delete(maintenancePreviews).where(eq(maintenancePreviews.taskId, taskId)).run();
  }

  async addApplyLog(input: AddMaintenanceApplyLogInput): Promise<MaintenanceApplyLogRecord> {
    const record = {
      id: input.id ?? randomUUID(),
      taskId: input.taskId,
      previewId: input.previewId,
      rootId: input.rootId,
      relativePath: input.relativePath,
      presetId: input.presetId,
      status: input.status,
      errorMessage: input.error ?? null,
      appliedAt: input.appliedAt ?? new Date(),
    };
    this.database.db.insert(maintenanceApplyLog).values(record).run();
    return toApplyLogRecord(record);
  }

  async listApplyLogs(taskId?: string): Promise<MaintenanceApplyLogRecord[]> {
    const rows = taskId
      ? this.database.db
          .select()
          .from(maintenanceApplyLog)
          .where(eq(maintenanceApplyLog.taskId, taskId))
          .orderBy(desc(maintenanceApplyLog.appliedAt))
          .all()
      : this.database.db.select().from(maintenanceApplyLog).orderBy(desc(maintenanceApplyLog.appliedAt)).all();
    return rows.map(toApplyLogRecord);
  }
}
