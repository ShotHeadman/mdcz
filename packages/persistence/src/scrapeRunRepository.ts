import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import type { LibraryFileInput, LibraryMovieInput } from "./libraryRepository";
import { writeLibraryRows } from "./libraryWrite";
import { libraryItemFiles, scrapeRunItems, scrapeRuns } from "./schema";

export type ScrapeExecutionMode = "single" | "batch";
export type ScrapeUncensoredChoice = "umr" | "leak" | "uncensored";
export type ScrapeTerminalOutcome = "success" | "failed" | "skipped";
export type ScrapeRunDisposition = "completed" | "failed" | "stopped" | "interrupted";

export interface ScrapeRunItemRecord {
  id: string;
  runId: string;
  ordinal: number;
  rootId: string;
  relativePath: string;
  manualUrl: string | null;
  uncensoredChoice: ScrapeUncensoredChoice | null;
  status: ScrapeTerminalOutcome | null;
  errorMessage: string | null;
  uncensoredAmbiguous: boolean;
  libraryFileId: string | null;
  completedAt: Date | null;
}

export interface ScrapeRunRecord {
  id: string;
  previousRunId: string | null;
  rootId: string;
  requestedOutputRootId: string | null;
  requestedOutputRelativeDirectory: string | null;
  executionMode: ScrapeExecutionMode;
  directoryScopeJson: string | null;
  configurationJson: string | null;
  manifestFixedAt: Date | null;
  discoveryJson: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  disposition: ScrapeRunDisposition | null;
  error: string | null;
  items: ScrapeRunItemRecord[];
}

export type ScrapeRunManifest = ScrapeRunRecord;

export type FinalizedScrapeRunRecord = ScrapeRunRecord & {
  disposition: ScrapeRunDisposition;
  completedAt: Date;
};

export interface ScrapeRunSummaryRecord {
  runId: string;
  disposition: ScrapeRunDisposition;
  startedAt: Date | null;
  completedAt: Date;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  totalBytes: number;
  outputRootId: string | null;
  error: string | null;
}

export interface CreateScrapeRunInput {
  id?: string;
  previousRunId?: string | null;
  rootId: string;
  outputRootId?: string | null;
  outputRelativeDirectory?: string | null;
  executionMode: ScrapeExecutionMode;
  directoryScopeJson?: string;
  configurationJson?: string;
  createdAt?: Date;
  items: Array<{
    id?: string;
    ordinal: number;
    rootId: string;
    relativePath: string;
    manualUrl?: string | null;
    uncensoredChoice?: ScrapeUncensoredChoice | null;
  }>;
}

export type CommitScrapeOutcomeInput =
  | {
      outcome: "failed" | "skipped";
      itemId: string;
      error?: string | null;
      completedAt?: Date;
    }
  | {
      outcome: "success";
      itemId: string;
      error?: string | null;
      uncensoredAmbiguous?: boolean;
      completedAt?: Date;
      libraryEntry: LibraryFileInput;
    };

export interface FinalizeScrapeRunInput {
  runId: string;
  disposition: ScrapeRunDisposition;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date;
  discoveryJson?: string;
}

const notFound = (entity: string, id: string): PersistenceError =>
  new PersistenceError(persistenceErrorCodes.NotFound, `${entity} not found: ${id}`);

export class ScrapeRunRepository {
  constructor(private readonly database: PersistenceDatabase) {}

  async create(input: CreateScrapeRunInput): Promise<ScrapeRunRecord> {
    if (
      input.directoryScopeJson &&
      (input.items.length > 0 || input.executionMode !== "batch" || !input.configurationJson)
    ) {
      throw new Error("Directory runs require a configuration and an unfixed batch manifest");
    }
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date();
    this.database.sqlite.transaction(() => {
      this.database.db
        .insert(scrapeRuns)
        .values({
          id,
          previousRunId: input.previousRunId ?? null,
          rootId: input.rootId,
          outputRootId: input.outputRootId ?? null,
          outputRelativeDirectory: input.outputRelativeDirectory || null,
          executionMode: input.executionMode,
          directoryScopeJson: input.directoryScopeJson ?? null,
          configurationJson: input.configurationJson ?? null,
          manifestFixedAt: input.directoryScopeJson ? null : createdAt,
          createdAt,
        })
        .run();
      if (input.items.length) {
        this.database.db
          .insert(scrapeRunItems)
          .values(
            input.items.map((item) => ({
              id: item.id ?? randomUUID(),
              runId: id,
              ordinal: item.ordinal,
              rootId: item.rootId,
              relativePath: item.relativePath,
              manualUrl: item.manualUrl ?? null,
              uncensoredChoice: item.uncensoredChoice ?? null,
              status: null,
              errorMessage: null,
              uncensoredAmbiguous: false,
              libraryFileId: null,
              completedAt: null,
            })),
          )
          .run();
      }
    })();
    return await this.get(id);
  }

  async get(runId: string): Promise<ScrapeRunRecord> {
    const run = this.database.db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId)).get();
    if (!run) throw notFound("Scrape run", runId);
    const items = this.database.db
      .select()
      .from(scrapeRunItems)
      .where(eq(scrapeRunItems.runId, runId))
      .orderBy(asc(scrapeRunItems.ordinal))
      .all();
    return {
      id: run.id,
      previousRunId: run.previousRunId,
      rootId: run.rootId,
      requestedOutputRootId: run.outputRootId,
      requestedOutputRelativeDirectory: run.outputRelativeDirectory,
      executionMode: run.executionMode,
      directoryScopeJson: run.directoryScopeJson,
      configurationJson: run.configurationJson,
      manifestFixedAt: run.manifestFixedAt,
      discoveryJson: run.discoveryJson,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      disposition: run.disposition,
      error: run.errorMessage,
      items,
    };
  }

  async getItem(itemId: string): Promise<ScrapeRunItemRecord> {
    const item = this.database.db.select().from(scrapeRunItems).where(eq(scrapeRunItems.id, itemId)).get();
    if (!item) throw notFound("Scrape item", itemId);
    return item;
  }

  async fixManifest(input: {
    runId: string;
    items: CreateScrapeRunInput["items"];
    discoveryJson: string;
    signal: AbortSignal;
  }): Promise<ScrapeRunRecord> {
    this.database.sqlite.transaction(() => {
      input.signal.throwIfAborted();
      const run = this.database.db.select().from(scrapeRuns).where(eq(scrapeRuns.id, input.runId)).get();
      if (!run || run.disposition || run.manifestFixedAt || !run.directoryScopeJson) {
        throw new Error(`Cannot fix scrape manifest: ${input.runId}`);
      }
      if (input.items.length) {
        this.database.db
          .insert(scrapeRunItems)
          .values(
            input.items.map((item) => ({
              ...item,
              id: item.id ?? randomUUID(),
              runId: input.runId,
              status: null,
              errorMessage: null,
              uncensoredAmbiguous: false,
              libraryFileId: null,
              completedAt: null,
            })),
          )
          .run();
      }
      this.database.db
        .update(scrapeRuns)
        .set({ manifestFixedAt: new Date(), discoveryJson: input.discoveryJson })
        .where(eq(scrapeRuns.id, input.runId))
        .run();
    })();
    return await this.get(input.runId);
  }

  async getLatestFinalized(): Promise<FinalizedScrapeRunRecord | null> {
    const row = this.database.db
      .select({ id: scrapeRuns.id })
      .from(scrapeRuns)
      .where(and(isNotNull(scrapeRuns.disposition), isNotNull(scrapeRuns.completedAt)))
      .orderBy(desc(scrapeRuns.createdAt))
      .limit(1)
      .get();
    if (!row) return null;
    const run = await this.get(row.id);
    if (!run.disposition || !run.completedAt) {
      throw new Error(`Finalized scrape run is missing terminal fields: ${run.id}`);
    }
    return { ...run, disposition: run.disposition, completedAt: run.completedAt };
  }

  async list(): Promise<ScrapeRunRecord[]> {
    const ids = this.database.db
      .select({ id: scrapeRuns.id })
      .from(scrapeRuns)
      .orderBy(desc(scrapeRuns.createdAt))
      .all();
    return await Promise.all(ids.map(({ id }) => this.get(id)));
  }

  commitOutcome(input: {
    itemId: string;
    outcome: "failed" | "skipped";
    error?: string | null;
    completedAt?: Date;
  }): ScrapeRunItemRecord {
    const completedAt = input.completedAt ?? new Date();
    const item = this.database.db.select().from(scrapeRunItems).where(eq(scrapeRunItems.id, input.itemId)).get();
    if (!item) throw notFound("Scrape item", input.itemId);
    this.database.db
      .update(scrapeRunItems)
      .set({
        status: input.outcome,
        errorMessage: input.error ?? null,
        completedAt,
      })
      .where(eq(scrapeRunItems.id, input.itemId))
      .run();
    return {
      ...item,
      status: input.outcome,
      errorMessage: input.error ?? null,
      completedAt,
    };
  }

  commitSuccessOutcomes(
    inputs: readonly {
      itemId: string;
      libraryEntry: LibraryFileInput;
      error?: string | null;
      uncensoredAmbiguous?: boolean;
      completedAt?: Date;
    }[],
    movie: LibraryMovieInput,
  ): Array<{
    itemId: string;
    fileId: string;
    outcomeId: string;
    entryId: string;
  }> {
    if (inputs.length === 0) throw new Error("Scrape success batch must not be empty");
    return this.database.sqlite.transaction(() => {
      const now = new Date();
      const libraryEntries = inputs.map((input) => {
        const fileId = input.libraryEntry.fileId ?? randomUUID();
        return { ...input.libraryEntry, fileId };
      });
      const entryId = writeLibraryRows(this.database, movie, libraryEntries);
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const fileId = libraryEntries[i].fileId;
        this.database.db
          .update(scrapeRunItems)
          .set({
            status: "success",
            errorMessage: input.error ?? null,
            uncensoredAmbiguous: input.uncensoredAmbiguous ?? false,
            libraryFileId: fileId,
            completedAt: input.completedAt ?? now,
          })
          .where(eq(scrapeRunItems.id, input.itemId))
          .run();
      }
      return inputs.map((input, i) => ({
        itemId: input.itemId,
        outcomeId: input.itemId,
        fileId: libraryEntries[i].fileId,
        entryId,
      }));
    })();
  }

  reviseSuccess(
    inputs: readonly {
      itemId?: string;
      outcomeId?: string;
      libraryEntry: LibraryFileInput;
      uncensoredAmbiguous?: boolean;
    }[],
    movie: LibraryMovieInput,
  ): void {
    this.database.sqlite.transaction(() => {
      const libraryEntries = inputs.map((input) => input.libraryEntry);
      if (libraryEntries.length) writeLibraryRows(this.database, movie, libraryEntries);
      for (const input of inputs) {
        const itemId = input.itemId ?? input.outcomeId;
        if (!itemId) throw new Error("Scrape success revision requires an item ID");
        this.database.db
          .update(scrapeRunItems)
          .set({
            uncensoredAmbiguous: input.uncensoredAmbiguous ?? false,
            libraryFileId: input.libraryEntry.fileId ?? null,
          })
          .where(eq(scrapeRunItems.id, itemId))
          .run();
      }
    })();
  }

  async finalize(input: FinalizeScrapeRunInput): Promise<ScrapeRunRecord> {
    const run = await this.get(input.runId);
    const unsettled = run.items.filter((item) => item.status === null);
    if (input.disposition === "completed" && (!run.manifestFixedAt || unsettled.length > 0)) {
      throw new Error(`Cannot finalize scrape run ${run.id}: ${unsettled.length} item(s) lack an outcome`);
    }
    const projectedDisposition =
      input.disposition === "interrupted"
        ? "interrupted"
        : input.disposition === "stopped"
          ? "stopped"
          : input.disposition === "failed" || run.items.some((item) => item.status !== "success")
            ? "failed"
            : "completed";
    this.database.db
      .update(scrapeRuns)
      .set({
        disposition: projectedDisposition,
        ...(input.discoveryJson ? { discoveryJson: input.discoveryJson } : {}),
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? new Date(),
        errorMessage: input.error ?? null,
      })
      .where(eq(scrapeRuns.id, run.id))
      .run();
    return await this.get(run.id);
  }

  interruptUnfinished(interruptedAt = new Date()): void {
    const unfinishedRuns = this.database.db
      .select({ id: scrapeRuns.id })
      .from(scrapeRuns)
      .where(isNull(scrapeRuns.disposition))
      .all();
    this.database.sqlite.transaction(() => {
      for (const { id } of unfinishedRuns) {
        this.database.db
          .update(scrapeRuns)
          .set({
            disposition: "interrupted",
            completedAt: interruptedAt,
            errorMessage: "Interrupted by shutdown",
          })
          .where(eq(scrapeRuns.id, id))
          .run();
        this.database.db
          .update(scrapeRunItems)
          .set({
            status: "failed",
            errorMessage: "任务已中断",
            completedAt: interruptedAt,
          })
          .where(and(eq(scrapeRunItems.runId, id), isNull(scrapeRunItems.status)))
          .run();
      }
    })();
  }

  async rerunDirectory(runId: string): Promise<ScrapeRunRecord> {
    const run = await this.get(runId);
    if (!run.disposition || !run.directoryScopeJson || !run.configurationJson) {
      throw new Error(`Directory run cannot be rerun: ${runId}`);
    }
    return await this.create({
      previousRunId: run.id,
      rootId: run.rootId,
      outputRootId: run.requestedOutputRootId,
      outputRelativeDirectory: run.requestedOutputRelativeDirectory,
      executionMode: "batch",
      directoryScopeJson: run.directoryScopeJson,
      configurationJson: run.configurationJson,
      items: [],
    });
  }

  async retry(runId: string, itemIds?: readonly string[]): Promise<ScrapeRunRecord> {
    const run = await this.get(runId);
    if (!run.disposition || run.disposition === "interrupted") {
      throw new Error(`Only completed, failed, or stopped scrape runs can be retried: ${run.id}`);
    }
    if (!run.manifestFixedAt) throw new Error("目录文件列表尚未生成，无法重试，请重新扫描目录");
    const itemsToRetry = itemIds
      ? (() => {
          const selectedIds = new Set(itemIds);
          if (selectedIds.size === 0) throw new Error(`Scrape retry requires at least one item: ${run.id}`);
          const unknownItemId = [...selectedIds].find((itemId) => !run.items.some((item) => item.id === itemId));
          if (unknownItemId) throw new Error(`Scrape item does not belong to run ${run.id}: ${unknownItemId}`);
          return run.items.filter((item) => selectedIds.has(item.id));
        })()
      : run.items.filter((item) => item.status === "failed" || item.status === "skipped" || item.status === null);
    if (itemsToRetry.length === 0) throw new Error(`Scrape run has no failed or skipped items to retry: ${run.id}`);

    return await this.create({
      previousRunId: run.id,
      rootId: run.rootId,
      outputRootId: run.requestedOutputRootId,
      outputRelativeDirectory: run.requestedOutputRelativeDirectory,
      executionMode: run.executionMode,
      configurationJson: run.configurationJson ?? undefined,
      items: itemsToRetry.map((item, ordinal) => ({
        ordinal,
        rootId: item.rootId,
        relativePath: item.relativePath,
        manualUrl: item.manualUrl,
        uncensoredChoice: item.uncensoredChoice,
      })),
    });
  }

  summary(run: ScrapeRunRecord): ScrapeRunSummaryRecord | null {
    if (!run.disposition || !run.completedAt) return null;
    const successItems = run.items.filter((item) => item.status === "success");
    const failedItems = run.items.filter((item) => item.status === "failed");
    const skippedItems = run.items.filter((item) => item.status === "skipped");
    const libraryFileIds = successItems.flatMap((item) => (item.libraryFileId ? [item.libraryFileId] : []));
    const totalBytes = libraryFileIds.length
      ? this.database.db
          .select({ size: libraryItemFiles.size })
          .from(libraryItemFiles)
          .where(inArray(libraryItemFiles.id, libraryFileIds))
          .all()
          .reduce((total, file) => total + file.size, 0)
      : 0;
    return {
      runId: run.id,
      disposition: run.disposition,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      successCount: successItems.length,
      failedCount: failedItems.length,
      skippedCount: skippedItems.length,
      totalBytes,
      outputRootId: run.requestedOutputRootId,
      error: run.error,
    };
  }

  itemResults(run: ScrapeRunRecord): Array<{
    id: string;
    itemId: string;
    outcome: string;
    error: string | null;
    outputRootId: string | null;
    outputRelativePath: string | null;
  }> {
    const libraryFileIds = run.items.flatMap((item) => (item.libraryFileId ? [item.libraryFileId] : []));
    const files = libraryFileIds.length
      ? this.database.db
          .select({ id: libraryItemFiles.id, rootId: libraryItemFiles.rootId, path: libraryItemFiles.rootRelativePath })
          .from(libraryItemFiles)
          .where(inArray(libraryItemFiles.id, libraryFileIds))
          .all()
      : [];
    const filesById = new Map(files.map((file) => [file.id, file]));
    return run.items.map((item) => {
      const file = item.libraryFileId ? filesById.get(item.libraryFileId) : undefined;
      return {
        id: item.id,
        itemId: item.id,
        outcome: item.status ?? "failed",
        error: item.errorMessage,
        outputRootId: file?.rootId ?? null,
        outputRelativePath: file?.path ?? null,
      };
    });
  }
}
