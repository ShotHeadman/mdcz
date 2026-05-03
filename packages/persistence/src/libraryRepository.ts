import { randomUUID } from "node:crypto";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import {
  type LibraryEntryRow,
  libraryEntries,
  type ScrapeOutputRow,
  type ScrapeResultRow,
  scrapeOutputs,
  scrapeResults,
} from "./schema";

export type ScrapeResultRecordStatus = "pending" | "processing" | "success" | "failed" | "skipped";

export interface ScrapeOutputRecord {
  id: string;
  taskId: string | null;
  rootId: string | null;
  outputDirectory: string | null;
  fileCount: number;
  totalBytes: number;
  completedAt: Date;
  createdAt: Date;
}

export interface LibraryEntryRecord {
  id: string;
  rootId: string;
  rootRelativePath: string;
  fileName: string;
  directory: string;
  size: number;
  modifiedAt: Date | null;
  sourceTaskId: string | null;
  scrapeOutputId: string | null;
  title: string | null;
  number: string | null;
  actors: string[];
  thumbnailPath: string | null;
  lastKnownPath: string | null;
  indexedAt: Date;
}

export interface ScrapeResultRecord {
  id: string;
  taskId: string;
  rootId: string;
  relativePath: string;
  status: ScrapeResultRecordStatus;
  error: string | null;
  crawlerDataJson: string | null;
  nfoRelativePath: string | null;
  outputRelativePath: string | null;
  manualUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertScrapeOutputInput {
  id?: string;
  taskId?: string | null;
  rootId?: string | null;
  outputDirectory?: string | null;
  fileCount: number;
  totalBytes: number;
  completedAt: Date;
  createdAt?: Date;
}

export interface UpsertLibraryEntryInput {
  id?: string;
  rootId: string;
  rootRelativePath: string;
  size?: number;
  modifiedAt?: Date | null;
  sourceTaskId?: string | null;
  scrapeOutputId?: string | null;
  title?: string | null;
  number?: string | null;
  actors?: string[];
  thumbnailPath?: string | null;
  lastKnownPath?: string | null;
  indexedAt?: Date;
}

export interface UpsertScrapeResultInput {
  id?: string;
  taskId: string;
  rootId: string;
  relativePath: string;
  status: ScrapeResultRecordStatus;
  error?: string | null;
  crawlerDataJson?: string | null;
  nfoRelativePath?: string | null;
  outputRelativePath?: string | null;
  manualUrl?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const safeActors = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const toScrapeOutputRecord = (row: ScrapeOutputRow): ScrapeOutputRecord => ({
  id: row.id,
  taskId: row.taskId,
  rootId: row.rootId,
  outputDirectory: row.outputDirectory,
  fileCount: row.fileCount,
  totalBytes: row.totalBytes,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
});

const toLibraryEntryRecord = (row: LibraryEntryRow): LibraryEntryRecord => ({
  id: row.id,
  rootId: row.rootId,
  rootRelativePath: row.rootRelativePath,
  fileName: row.fileName,
  directory: row.directory,
  size: row.size,
  modifiedAt: row.modifiedAt,
  sourceTaskId: row.sourceTaskId,
  scrapeOutputId: row.scrapeOutputId,
  title: row.title,
  number: row.number,
  actors: safeActors(row.actorsJson),
  thumbnailPath: row.thumbnailPath,
  lastKnownPath: row.lastKnownPath,
  indexedAt: row.indexedAt,
});

const toScrapeResultRecord = (row: ScrapeResultRow): ScrapeResultRecord => ({
  id: row.id,
  taskId: row.taskId,
  rootId: row.rootId,
  relativePath: row.relativePath,
  status: row.status as ScrapeResultRecordStatus,
  error: row.errorMessage,
  crawlerDataJson: row.crawlerDataJson,
  nfoRelativePath: row.nfoRelativePath,
  outputRelativePath: row.outputRelativePath,
  manualUrl: row.manualUrl,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class LibraryRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  async upsertScrapeOutput(input: UpsertScrapeOutputInput): Promise<ScrapeOutputRecord> {
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date();
    this.database.db
      .insert(scrapeOutputs)
      .values({
        id,
        taskId: input.taskId ?? null,
        rootId: input.rootId ?? null,
        outputDirectory: input.outputDirectory ?? null,
        fileCount: input.fileCount,
        totalBytes: input.totalBytes,
        completedAt: input.completedAt,
        createdAt,
      })
      .onConflictDoUpdate({
        target: scrapeOutputs.id,
        set: {
          taskId: input.taskId ?? null,
          rootId: input.rootId ?? null,
          outputDirectory: input.outputDirectory ?? null,
          fileCount: input.fileCount,
          totalBytes: input.totalBytes,
          completedAt: input.completedAt,
        },
      })
      .run();
    return await this.getScrapeOutput(id);
  }

  async latestScrapeOutput(): Promise<ScrapeOutputRecord | null> {
    const row = this.database.db.select().from(scrapeOutputs).orderBy(desc(scrapeOutputs.completedAt)).limit(1).get();
    return row ? toScrapeOutputRecord(row) : null;
  }

  async getScrapeOutput(id: string): Promise<ScrapeOutputRecord> {
    const row = this.database.db.select().from(scrapeOutputs).where(eq(scrapeOutputs.id, id)).limit(1).get();
    if (!row) {
      throw new Error(`Scrape output not found: ${id}`);
    }
    return toScrapeOutputRecord(row);
  }

  async upsertEntry(input: UpsertLibraryEntryInput): Promise<LibraryEntryRecord> {
    const id = input.id ?? `${input.rootId}:${input.rootRelativePath}`;
    const directory = path.posix.dirname(input.rootRelativePath);
    const indexedAt = input.indexedAt ?? new Date();
    this.database.db
      .insert(libraryEntries)
      .values({
        id,
        rootId: input.rootId,
        rootRelativePath: input.rootRelativePath,
        fileName: path.posix.basename(input.rootRelativePath),
        directory: directory === "." ? "" : directory,
        size: input.size ?? 0,
        modifiedAt: input.modifiedAt ?? null,
        sourceTaskId: input.sourceTaskId ?? null,
        scrapeOutputId: input.scrapeOutputId ?? null,
        title: input.title ?? null,
        number: input.number ?? null,
        actorsJson: JSON.stringify(input.actors ?? []),
        thumbnailPath: input.thumbnailPath ?? null,
        lastKnownPath: input.lastKnownPath ?? null,
        indexedAt,
      })
      .onConflictDoUpdate({
        target: [libraryEntries.rootId, libraryEntries.rootRelativePath],
        set: {
          id,
          fileName: path.posix.basename(input.rootRelativePath),
          directory: directory === "." ? "" : directory,
          size: input.size ?? 0,
          modifiedAt: input.modifiedAt ?? null,
          sourceTaskId: input.sourceTaskId ?? null,
          scrapeOutputId: input.scrapeOutputId ?? null,
          title: input.title ?? null,
          number: input.number ?? null,
          actorsJson: JSON.stringify(input.actors ?? []),
          thumbnailPath: input.thumbnailPath ?? null,
          lastKnownPath: input.lastKnownPath ?? null,
          indexedAt,
        },
      })
      .run();
    return await this.getEntry(input.rootId, input.rootRelativePath);
  }

  async deleteEntriesForTask(taskId: string): Promise<void> {
    this.database.db.delete(libraryEntries).where(eq(libraryEntries.sourceTaskId, taskId)).run();
  }

  async upsertScrapeResult(input: UpsertScrapeResultInput): Promise<ScrapeResultRecord> {
    const id = input.id ?? randomUUID();
    const now = new Date();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;
    this.database.db
      .insert(scrapeResults)
      .values({
        id,
        taskId: input.taskId,
        rootId: input.rootId,
        relativePath: input.relativePath,
        status: input.status,
        errorMessage: input.error ?? null,
        crawlerDataJson: input.crawlerDataJson ?? null,
        nfoRelativePath: input.nfoRelativePath ?? null,
        outputRelativePath: input.outputRelativePath ?? null,
        manualUrl: input.manualUrl ?? null,
        createdAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: scrapeResults.id,
        set: {
          status: input.status,
          errorMessage: input.error ?? null,
          crawlerDataJson: input.crawlerDataJson ?? null,
          nfoRelativePath: input.nfoRelativePath ?? null,
          outputRelativePath: input.outputRelativePath ?? null,
          manualUrl: input.manualUrl ?? null,
          updatedAt,
        },
      })
      .run();
    return await this.getScrapeResult(id);
  }

  async listScrapeResults(taskId?: string): Promise<ScrapeResultRecord[]> {
    const rows = taskId
      ? this.database.db
          .select()
          .from(scrapeResults)
          .where(eq(scrapeResults.taskId, taskId))
          .orderBy(scrapeResults.relativePath)
          .all()
      : this.database.db.select().from(scrapeResults).orderBy(desc(scrapeResults.updatedAt)).all();
    return rows.map(toScrapeResultRecord);
  }

  async getScrapeResult(id: string): Promise<ScrapeResultRecord> {
    const row = this.database.db.select().from(scrapeResults).where(eq(scrapeResults.id, id)).limit(1).get();
    if (!row) {
      throw new Error(`Scrape result not found: ${id}`);
    }
    return toScrapeResultRecord(row);
  }

  async deleteScrapeResultsForTask(taskId: string): Promise<void> {
    this.database.db.delete(scrapeResults).where(eq(scrapeResults.taskId, taskId)).run();
  }

  async getEntry(rootId: string, rootRelativePath: string): Promise<LibraryEntryRecord> {
    const row = this.database.db
      .select()
      .from(libraryEntries)
      .where(sql`${libraryEntries.rootId} = ${rootId} AND ${libraryEntries.rootRelativePath} = ${rootRelativePath}`)
      .limit(1)
      .get();
    if (!row) {
      throw new Error(`Library entry not found: ${rootId}:${rootRelativePath}`);
    }
    return toLibraryEntryRecord(row);
  }

  async listEntries(): Promise<LibraryEntryRecord[]> {
    const rows = this.database.db.select().from(libraryEntries).orderBy(desc(libraryEntries.indexedAt)).all();
    return rows.map(toLibraryEntryRecord);
  }
}
