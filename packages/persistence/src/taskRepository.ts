import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import {
  type ScanResultRow,
  scanResults,
  type TaskEventRow,
  type TaskRecordRow,
  taskEvents,
  taskRecords,
} from "./schema";

export type TaskRecordKind = "scan";
export type TaskRecordStatus = "queued" | "running" | "completed" | "failed";

export interface TaskRecord {
  id: string;
  kind: TaskRecordKind;
  rootId: string;
  status: TaskRecordStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  videoCount: number;
  directoryCount: number;
  error: string | null;
}

export interface TaskEventRecord {
  id: string;
  taskId: string;
  type: string;
  message: string;
  createdAt: Date;
}

export interface ScanResultRecord {
  taskId: string;
  rootId: string;
  relativePath: string;
  size: number;
  modifiedAt: Date | null;
}

export interface CreateScanTaskInput {
  id?: string;
  rootId: string;
  now?: Date;
}

export interface PatchTaskInput {
  status?: TaskRecordStatus;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  videoCount?: number;
  directoryCount?: number;
  error?: string | null;
  updatedAt?: Date;
}

export interface AddTaskEventInput {
  id?: string;
  taskId: string;
  type: string;
  message: string;
  createdAt?: Date;
}

export interface ReplaceScanResultsInput {
  taskId: string;
  rootId: string;
  results: Array<{ relativePath: string; size: number; modifiedAt: Date | null }>;
}

const toTaskRecord = (row: TaskRecordRow): TaskRecord => ({
  id: row.id,
  kind: row.kind as TaskRecordKind,
  rootId: row.rootId,
  status: row.status as TaskRecordStatus,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  startedAt: row.startedAt,
  finishedAt: row.completedAt,
  videoCount: row.videoCount,
  directoryCount: row.directoryCount,
  error: row.errorMessage,
});

const toTaskEventRecord = (row: TaskEventRow): TaskEventRecord => ({
  id: row.id,
  taskId: row.taskId,
  type: row.type,
  message: row.message,
  createdAt: row.createdAt,
});

const toScanResultRecord = (row: ScanResultRow): ScanResultRecord => ({
  taskId: row.taskId,
  rootId: row.rootId,
  relativePath: row.relativePath,
  size: row.size,
  modifiedAt: row.modifiedAt,
});

export class TaskRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  async createScanTask(input: CreateScanTaskInput): Promise<TaskRecord> {
    const now = input.now ?? new Date();
    const task: TaskRecord = {
      id: input.id ?? randomUUID(),
      kind: "scan",
      rootId: input.rootId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      videoCount: 0,
      directoryCount: 0,
      error: null,
    };

    this.database.db
      .insert(taskRecords)
      .values({
        id: task.id,
        kind: task.kind,
        rootId: task.rootId,
        status: task.status,
        summary: null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        startedAt: task.startedAt,
        completedAt: task.finishedAt,
        errorMessage: task.error,
        videoCount: task.videoCount,
        directoryCount: task.directoryCount,
      })
      .run();

    return task;
  }

  async patch(id: string, patch: PatchTaskInput): Promise<TaskRecord> {
    const existing = await this.get(id);
    const updatedAt = patch.updatedAt ?? new Date();
    this.database.db
      .update(taskRecords)
      .set({
        status: patch.status ?? existing.status,
        updatedAt,
        startedAt: patch.startedAt !== undefined ? patch.startedAt : existing.startedAt,
        completedAt: patch.finishedAt !== undefined ? patch.finishedAt : existing.finishedAt,
        errorMessage: patch.error !== undefined ? patch.error : existing.error,
        videoCount: patch.videoCount ?? existing.videoCount,
        directoryCount: patch.directoryCount ?? existing.directoryCount,
      })
      .where(eq(taskRecords.id, id))
      .run();

    return await this.get(id);
  }

  async list(kind?: TaskRecordKind): Promise<TaskRecord[]> {
    const rows = kind
      ? this.database.db
          .select()
          .from(taskRecords)
          .where(eq(taskRecords.kind, kind))
          .orderBy(desc(taskRecords.createdAt))
          .all()
      : this.database.db.select().from(taskRecords).orderBy(desc(taskRecords.createdAt)).all();
    return rows.map(toTaskRecord);
  }

  async get(id: string): Promise<TaskRecord> {
    const row = this.database.db.select().from(taskRecords).where(eq(taskRecords.id, id)).limit(1).get();
    if (!row) {
      throw new PersistenceError(persistenceErrorCodes.NotFound, `Task not found: ${id}`);
    }
    return toTaskRecord(row);
  }

  async nextQueued(kind: TaskRecordKind): Promise<TaskRecord | null> {
    const row = this.database.db
      .select()
      .from(taskRecords)
      .where(and(eq(taskRecords.kind, kind), eq(taskRecords.status, "queued")))
      .orderBy(taskRecords.createdAt)
      .limit(1)
      .get();
    return row ? toTaskRecord(row) : null;
  }

  async requeueRunning(kind: TaskRecordKind): Promise<void> {
    this.database.db
      .update(taskRecords)
      .set({ status: "queued", startedAt: null, updatedAt: new Date() })
      .where(and(eq(taskRecords.kind, kind), eq(taskRecords.status, "running")))
      .run();
  }

  async addEvent(input: AddTaskEventInput): Promise<TaskEventRecord> {
    const event: TaskEventRecord = {
      id: input.id ?? randomUUID(),
      taskId: input.taskId,
      type: input.type,
      message: input.message,
      createdAt: input.createdAt ?? new Date(),
    };
    this.database.db.insert(taskEvents).values(event).run();
    return event;
  }

  async listEvents(taskId: string): Promise<TaskEventRecord[]> {
    const rows = this.database.db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .orderBy(taskEvents.createdAt)
      .all();
    return rows.map(toTaskEventRecord);
  }

  async replaceScanResults(input: ReplaceScanResultsInput): Promise<void> {
    const values = input.results.map((result) => ({
      taskId: input.taskId,
      rootId: input.rootId,
      relativePath: result.relativePath,
      size: result.size,
      modifiedAt: result.modifiedAt,
    }));

    const transaction = this.database.sqlite.transaction(() => {
      this.database.db.delete(scanResults).where(eq(scanResults.taskId, input.taskId)).run();
      if (values.length > 0) {
        this.database.db.insert(scanResults).values(values).run();
      }
    });
    transaction();
  }

  async listScanResults(taskId: string): Promise<ScanResultRecord[]> {
    const rows = this.database.db
      .select()
      .from(scanResults)
      .where(eq(scanResults.taskId, taskId))
      .orderBy(scanResults.relativePath)
      .all();
    return rows.map(toScanResultRecord);
  }
}
