import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
export type TaskRecordStatus = "queued" | "running" | "completed" | "failed" | "paused" | "stopping";

export interface TaskRecord {
  id: string;
  kind: TaskRecordKind;
  rootId: string;
  status: TaskRecordStatus;
  executionVersion: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
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
  completedAt?: Date | null;
  videoCount?: number;
  directoryCount?: number;
  error?: string | null;
  updatedAt?: Date;
}

export interface TaskUpdateGuard {
  status: TaskRecordStatus | readonly TaskRecordStatus[];
  executionVersion: number;
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

export interface CompleteScanTaskInput extends ReplaceScanResultsInput {
  executionVersion: number;
  directoryCount: number;
  completedAt?: Date;
}

const toTaskRecord = (row: TaskRecordRow): TaskRecord => ({
  id: row.id,
  kind: row.kind,
  rootId: row.rootId,
  status: row.status as TaskRecordStatus,
  executionVersion: row.executionVersion,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
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
      executionVersion: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
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
        executionVersion: task.executionVersion,
        summary: null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        errorMessage: task.error,
        videoCount: task.videoCount,
        directoryCount: task.directoryCount,
      })
      .run();

    return task;
  }

  async patch(id: string, patch: PatchTaskInput): Promise<TaskRecord>;
  async patch(id: string, patch: PatchTaskInput, guard: TaskUpdateGuard): Promise<TaskRecord | null>;
  async patch(id: string, patch: PatchTaskInput, guard?: TaskUpdateGuard): Promise<TaskRecord | null> {
    const updatedAt = patch.updatedAt ?? new Date();
    const result = this.database.db
      .update(taskRecords)
      .set({
        status: patch.status,
        updatedAt,
        startedAt: patch.startedAt,
        completedAt: patch.completedAt,
        errorMessage: patch.error,
        videoCount: patch.videoCount,
        directoryCount: patch.directoryCount,
      })
      .where(
        guard
          ? and(
              eq(taskRecords.id, id),
              eq(taskRecords.kind, "scan"),
              Array.isArray(guard.status)
                ? inArray(taskRecords.status, [...guard.status])
                : eq(taskRecords.status, guard.status as TaskRecordStatus),
              eq(taskRecords.executionVersion, guard.executionVersion),
            )
          : and(eq(taskRecords.id, id), eq(taskRecords.kind, "scan")),
      )
      .run();

    if (result.changes === 0) {
      if (guard) return null;
      await this.get(id);
    }
    return await this.get(id);
  }

  async list(): Promise<TaskRecord[]> {
    const rows = this.database.db
      .select()
      .from(taskRecords)
      .where(eq(taskRecords.kind, "scan"))
      .orderBy(desc(taskRecords.createdAt))
      .all();
    return rows.map(toTaskRecord);
  }

  async get(id: string): Promise<TaskRecord> {
    const row = this.database.db
      .select()
      .from(taskRecords)
      .where(and(eq(taskRecords.id, id), eq(taskRecords.kind, "scan")))
      .limit(1)
      .get();
    if (!row) {
      throw new PersistenceError(persistenceErrorCodes.NotFound, `Task not found: ${id}`);
    }
    return toTaskRecord(row);
  }

  async claimNext(now = new Date()): Promise<TaskRecord | null> {
    return this.database.db.transaction((tx) => {
      const queued = tx
        .select()
        .from(taskRecords)
        .where(and(eq(taskRecords.kind, "scan"), eq(taskRecords.status, "queued")))
        .orderBy(taskRecords.createdAt)
        .limit(1)
        .get();
      if (!queued) return null;

      const claimed = tx
        .update(taskRecords)
        .set({
          status: "running",
          executionVersion: sql`${taskRecords.executionVersion} + 1`,
          startedAt: now,
          completedAt: null,
          errorMessage: null,
          updatedAt: now,
        })
        .where(and(eq(taskRecords.id, queued.id), eq(taskRecords.status, "queued")))
        .run();
      if (claimed.changes === 0) return null;

      const row = tx.select().from(taskRecords).where(eq(taskRecords.id, queued.id)).limit(1).get();
      return row ? toTaskRecord(row) : null;
    });
  }

  async claim(id: string, expectedExecutionVersion: number, now = new Date()): Promise<TaskRecord | null> {
    const claimed = this.database.db
      .update(taskRecords)
      .set({
        status: "running",
        executionVersion: sql`${taskRecords.executionVersion} + 1`,
        startedAt: now,
        completedAt: null,
        errorMessage: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(taskRecords.id, id),
          eq(taskRecords.kind, "scan"),
          eq(taskRecords.status, "queued"),
          eq(taskRecords.executionVersion, expectedExecutionVersion),
        ),
      )
      .run();
    return claimed.changes === 1 ? await this.get(id) : null;
  }

  async requeue(id: string, guard: TaskUpdateGuard, now = new Date()): Promise<TaskRecord | null> {
    const statusCondition = Array.isArray(guard.status)
      ? inArray(taskRecords.status, [...guard.status])
      : eq(taskRecords.status, guard.status as TaskRecordStatus);
    const requeued = this.database.db
      .update(taskRecords)
      .set({
        status: "queued",
        executionVersion: sql`${taskRecords.executionVersion} + 1`,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(taskRecords.id, id),
          eq(taskRecords.kind, "scan"),
          statusCondition,
          eq(taskRecords.executionVersion, guard.executionVersion),
        ),
      )
      .run();
    return requeued.changes === 1 ? await this.get(id) : null;
  }

  async requeueRunning(): Promise<void> {
    this.database.db
      .update(taskRecords)
      .set({
        status: "queued",
        executionVersion: sql`${taskRecords.executionVersion} + 1`,
        startedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(taskRecords.kind, "scan"), inArray(taskRecords.status, ["running", "stopping"])))
      .run();
  }

  async addEvent(input: AddTaskEventInput): Promise<TaskEventRecord> {
    await this.get(input.taskId);
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
    await this.get(taskId);
    const rows = this.database.db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .orderBy(taskEvents.createdAt)
      .all();
    return rows.map(toTaskEventRecord);
  }

  async replaceScanResults(input: ReplaceScanResultsInput): Promise<void> {
    const values = this.toScanResultValues(input);
    await this.get(input.taskId);

    const transaction = this.database.sqlite.transaction(() => {
      this.database.db.delete(scanResults).where(eq(scanResults.taskId, input.taskId)).run();
      if (values.length > 0) {
        this.database.db.insert(scanResults).values(values).run();
      }
    });
    transaction();
  }

  async completeScanTask(input: CompleteScanTaskInput): Promise<TaskRecord | null> {
    const values = this.toScanResultValues(input);
    const completedAt = input.completedAt ?? new Date();
    const transaction = this.database.sqlite.transaction(() => {
      const owned = this.database.db
        .select({ id: taskRecords.id })
        .from(taskRecords)
        .where(
          and(
            eq(taskRecords.id, input.taskId),
            eq(taskRecords.kind, "scan"),
            eq(taskRecords.status, "running"),
            eq(taskRecords.executionVersion, input.executionVersion),
          ),
        )
        .limit(1)
        .get();
      if (!owned) return false;

      this.database.db.delete(scanResults).where(eq(scanResults.taskId, input.taskId)).run();
      if (values.length > 0) this.database.db.insert(scanResults).values(values).run();
      const committed = this.database.db
        .update(taskRecords)
        .set({
          status: "completed",
          completedAt,
          updatedAt: completedAt,
          videoCount: values.length,
          directoryCount: input.directoryCount,
          errorMessage: null,
        })
        .where(
          and(
            eq(taskRecords.id, input.taskId),
            eq(taskRecords.kind, "scan"),
            eq(taskRecords.status, "running"),
            eq(taskRecords.executionVersion, input.executionVersion),
          ),
        )
        .run();
      return committed.changes === 1;
    });
    if (!transaction()) return null;
    return await this.get(input.taskId);
  }

  async listScanResults(taskId: string): Promise<ScanResultRecord[]> {
    await this.get(taskId);
    const rows = this.database.db
      .select()
      .from(scanResults)
      .where(eq(scanResults.taskId, taskId))
      .orderBy(scanResults.relativePath)
      .all();
    return rows.map(toScanResultRecord);
  }

  async listAllScanResults(): Promise<ScanResultRecord[]> {
    return this.database.db
      .select({
        taskId: scanResults.taskId,
        rootId: scanResults.rootId,
        relativePath: scanResults.relativePath,
        size: scanResults.size,
        modifiedAt: scanResults.modifiedAt,
      })
      .from(scanResults)
      .innerJoin(taskRecords, and(eq(taskRecords.id, scanResults.taskId), eq(taskRecords.kind, "scan")))
      .orderBy(scanResults.relativePath)
      .all();
  }

  private toScanResultValues(input: ReplaceScanResultsInput) {
    const seenPaths = new Set<string>();
    for (const result of input.results) {
      if (seenPaths.has(result.relativePath)) {
        throw new PersistenceError(
          persistenceErrorCodes.ConstraintViolation,
          `Duplicate scan result path for task ${input.taskId}: ${result.relativePath}`,
        );
      }
      seenPaths.add(result.relativePath);
    }
    return input.results.map((result) => ({
      taskId: input.taskId,
      rootId: input.rootId,
      relativePath: result.relativePath,
      size: result.size,
      modifiedAt: result.modifiedAt,
    }));
  }
}
