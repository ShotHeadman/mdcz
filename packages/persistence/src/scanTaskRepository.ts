import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import {
  type ScanResultRow,
  type ScanTaskEventRow,
  type ScanTaskRow,
  scanResults,
  scanTaskEvents,
  scanTasks,
} from "./schema";

export type ScanTaskStatus = "queued" | "running" | "completed" | "failed" | "paused" | "stopping";

export interface ScanTask {
  id: string;
  rootId: string;
  status: ScanTaskStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  videoCount: number;
  directoryCount: number;
  error: string | null;
}

export interface ScanTaskEvent {
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
  directoryCount: number;
  completedAt?: Date;
}

const toScanTask = (row: ScanTaskRow): ScanTask => ({
  id: row.id,
  rootId: row.rootId,
  status: row.status as ScanTaskStatus,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  videoCount: row.videoCount,
  directoryCount: row.directoryCount,
  error: row.errorMessage,
});

const toScanTaskEvent = (row: ScanTaskEventRow): ScanTaskEvent => ({
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

export class ScanTaskRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  async create(input: CreateScanTaskInput): Promise<ScanTask> {
    const now = input.now ?? new Date();
    const task: ScanTask = {
      id: input.id ?? randomUUID(),
      rootId: input.rootId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      videoCount: 0,
      directoryCount: 0,
      error: null,
    };

    this.database.db
      .insert(scanTasks)
      .values({
        id: task.id,
        rootId: task.rootId,
        status: task.status,
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

  async list(): Promise<ScanTask[]> {
    const rows = this.database.db.select().from(scanTasks).orderBy(desc(scanTasks.createdAt)).all();
    return rows.map(toScanTask);
  }

  async get(id: string): Promise<ScanTask> {
    const row = this.database.db.select().from(scanTasks).where(eq(scanTasks.id, id)).limit(1).get();
    if (!row) {
      throw new PersistenceError(persistenceErrorCodes.NotFound, `Task not found: ${id}`);
    }
    return toScanTask(row);
  }

  async claim(id: string, now = new Date()): Promise<ScanTask | null> {
    const claimed = this.database.db
      .update(scanTasks)
      .set({
        status: "running",
        startedAt: now,
        completedAt: null,
        errorMessage: null,
        updatedAt: now,
      })
      .where(and(eq(scanTasks.id, id), eq(scanTasks.status, "queued")))
      .run();
    return claimed.changes === 1 ? await this.get(id) : null;
  }

  async requeue(id: string, now = new Date()): Promise<ScanTask | null> {
    const transaction = this.database.sqlite.transaction(() => {
      const requeued = this.database.db
        .update(scanTasks)
        .set({
          status: "queued",
          startedAt: null,
          completedAt: null,
          errorMessage: null,
          videoCount: 0,
          directoryCount: 0,
          updatedAt: now,
        })
        .where(and(eq(scanTasks.id, id), inArray(scanTasks.status, ["completed", "failed"])))
        .run();
      if (requeued.changes === 0) return false;
      this.database.db.delete(scanResults).where(eq(scanResults.taskId, id)).run();
      return true;
    });
    return transaction() ? await this.get(id) : null;
  }

  async fail(id: string, error: string, completedAt = new Date()): Promise<ScanTask | null> {
    const failed = this.database.db
      .update(scanTasks)
      .set({ status: "failed", completedAt, errorMessage: error, updatedAt: completedAt })
      .where(and(eq(scanTasks.id, id), eq(scanTasks.status, "running")))
      .run();
    return failed.changes === 1 ? await this.get(id) : null;
  }

  async interruptUnfinished(error: string, completedAt = new Date()): Promise<ScanTask[]> {
    const transaction = this.database.sqlite.transaction(() => {
      const ids = this.database.db
        .select({ id: scanTasks.id })
        .from(scanTasks)
        .where(inArray(scanTasks.status, ["queued", "running"]))
        .all()
        .map(({ id }) => id);
      if (ids.length === 0) return ids;
      this.database.db
        .update(scanTasks)
        .set({ status: "failed", completedAt, errorMessage: error, updatedAt: completedAt })
        .where(inArray(scanTasks.id, ids))
        .run();
      return ids;
    });
    return await Promise.all(transaction().map(async (id) => await this.get(id)));
  }

  async addEvent(input: AddTaskEventInput): Promise<ScanTaskEvent> {
    await this.get(input.taskId);
    const event: ScanTaskEvent = {
      id: input.id ?? randomUUID(),
      taskId: input.taskId,
      type: input.type,
      message: input.message,
      createdAt: input.createdAt ?? new Date(),
    };
    this.database.db.insert(scanTaskEvents).values(event).run();
    return event;
  }

  async listEvents(taskId: string): Promise<ScanTaskEvent[]> {
    await this.get(taskId);
    const rows = this.database.db
      .select()
      .from(scanTaskEvents)
      .where(eq(scanTaskEvents.taskId, taskId))
      .orderBy(scanTaskEvents.createdAt)
      .all();
    return rows.map(toScanTaskEvent);
  }

  async complete(input: CompleteScanTaskInput): Promise<ScanTask | null> {
    const values = this.toScanResultValues(input);
    const completedAt = input.completedAt ?? new Date();
    const transaction = this.database.sqlite.transaction(() => {
      const owned = this.database.db
        .select({ id: scanTasks.id })
        .from(scanTasks)
        .where(and(eq(scanTasks.id, input.taskId), eq(scanTasks.status, "running")))
        .limit(1)
        .get();
      if (!owned) return false;

      this.database.db.delete(scanResults).where(eq(scanResults.taskId, input.taskId)).run();
      if (values.length > 0) this.database.db.insert(scanResults).values(values).run();
      const committed = this.database.db
        .update(scanTasks)
        .set({
          status: "completed",
          completedAt,
          updatedAt: completedAt,
          videoCount: values.length,
          directoryCount: input.directoryCount,
          errorMessage: null,
        })
        .where(and(eq(scanTasks.id, input.taskId), eq(scanTasks.status, "running")))
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
