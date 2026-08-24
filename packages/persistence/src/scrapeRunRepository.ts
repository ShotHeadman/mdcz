import { randomUUID } from "node:crypto";
import { asc, count, desc, eq } from "drizzle-orm";

import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import {
  type LibraryEntryRecord,
  LibraryRepository,
  type UpsertLibraryEntryInput,
  writeLibraryEntry,
} from "./libraryRepository";
import {
  type ScrapeItemOutcomeRow,
  type ScrapeRunItemRow,
  type ScrapeRunRow,
  type ScrapeRunSummaryRow,
  scrapeItemOutcomes,
  scrapeRunItems,
  scrapeRunSummaries,
  scrapeRuns,
} from "./schema";

export type ScrapeExecutionMode = "single" | "batch";
export type ScrapeUncensoredChoice = "umr" | "leak" | "uncensored";
export type ScrapeTerminalOutcome = "success" | "failed" | "skipped";
export type ScrapeRunDisposition = "completed" | "failed" | "stopped";

export interface ScrapeRunItemRecord {
  id: string;
  runId: string;
  ordinal: number;
  rootId: string;
  relativePath: string;
  manualUrl: string | null;
  uncensoredChoice: ScrapeUncensoredChoice | null;
}

export interface ScrapeRunManifest {
  id: string;
  rootId: string;
  outputRootId: string | null;
  executionMode: ScrapeExecutionMode;
  createdAt: Date;
  items: ScrapeRunItemRecord[];
}

export interface ScrapeItemOutcomeRecord {
  id: string;
  runId: string;
  itemId: string;
  attempt: number;
  outcome: ScrapeTerminalOutcome;
  error: string | null;
  crawlerDataJson: string | null;
  nfoRootId: string | null;
  nfoRelativePath: string | null;
  outputRootId: string | null;
  outputRelativePath: string | null;
  uncensoredAmbiguous: boolean;
  size: number;
  modifiedAt: Date | null;
  completedAt: Date;
}

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
  outputDirectory: string | null;
  error: string | null;
}

export interface CreateScrapeRunInput {
  id?: string;
  rootId: string;
  outputRootId?: string | null;
  executionMode: ScrapeExecutionMode;
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

export interface CommitScrapeFailureInput {
  id?: string;
  runId: string;
  itemId: string;
  attempt: number;
  error: string;
  completedAt?: Date;
}

export interface CommitScrapeSkippedInput {
  id?: string;
  runId: string;
  itemId: string;
  attempt: number;
  error?: string | null;
  completedAt?: Date;
}

export interface CommitScrapeSuccessInput {
  id?: string;
  runId: string;
  itemId: string;
  attempt: number;
  crawlerDataJson: string;
  nfoRootId?: string | null;
  nfoRelativePath?: string | null;
  outputRootId: string;
  outputRelativePath: string;
  uncensoredAmbiguous?: boolean;
  size: number;
  modifiedAt?: Date | null;
  completedAt?: Date;
  libraryEntry: UpsertLibraryEntryInput;
}

export interface ReviseScrapeSuccessInput {
  outcomeId: string;
  crawlerDataJson: string;
  nfoRootId?: string | null;
  nfoRelativePath?: string | null;
  outputRootId: string;
  outputRelativePath: string;
  uncensoredAmbiguous: boolean;
  size: number;
  modifiedAt?: Date | null;
  libraryEntry: UpsertLibraryEntryInput;
}

export interface FinalizeScrapeRunInput {
  runId: string;
  disposition: ScrapeRunDisposition;
  outputRootId?: string | null;
  outputDirectory?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date;
}

const toItemRecord = (row: ScrapeRunItemRow): ScrapeRunItemRecord => ({
  id: row.id,
  runId: row.runId,
  ordinal: row.ordinal,
  rootId: row.rootId,
  relativePath: row.relativePath,
  manualUrl: row.manualUrl,
  uncensoredChoice: row.uncensoredChoice,
});

const toOutcomeRecord = (row: ScrapeItemOutcomeRow): ScrapeItemOutcomeRecord => ({
  id: row.id,
  runId: row.runId,
  itemId: row.itemId,
  attempt: row.attempt,
  outcome: row.outcome,
  error: row.errorMessage,
  crawlerDataJson: row.crawlerDataJson,
  nfoRootId: row.nfoRootId,
  nfoRelativePath: row.nfoRelativePath,
  outputRootId: row.outputRootId,
  outputRelativePath: row.outputRelativePath,
  uncensoredAmbiguous: row.uncensoredAmbiguous,
  size: row.size,
  modifiedAt: row.modifiedAt,
  completedAt: row.completedAt,
});

const toSummaryRecord = (row: ScrapeRunSummaryRow): ScrapeRunSummaryRecord => ({
  runId: row.runId,
  disposition: row.disposition,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  successCount: row.successCount,
  failedCount: row.failedCount,
  skippedCount: row.skippedCount,
  totalBytes: row.totalBytes,
  outputRootId: row.outputRootId,
  outputDirectory: row.outputDirectory,
  error: row.errorMessage,
});

const constraint = (message: string): PersistenceError =>
  new PersistenceError(persistenceErrorCodes.ConstraintViolation, message);

const requireNonEmpty = (value: string, field: string): void => {
  if (value.trim().length === 0) throw constraint(`${field} must not be empty`);
};

const requireNonNegativeInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw constraint(`${field} must be a non-negative integer`);
};

const requirePositiveInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) throw constraint(`${field} must be a positive integer`);
};

export class ScrapeRunRepository {
  private readonly library: LibraryRepository;

  constructor(private readonly database: PersistenceDatabase) {
    this.library = new LibraryRepository(database);
  }

  async createRun(input: CreateScrapeRunInput): Promise<ScrapeRunManifest> {
    this.validateManifest(input);
    const runId = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date();
    const items = input.items.map((item) => ({
      id: item.id ?? randomUUID(),
      runId,
      ordinal: item.ordinal,
      rootId: item.rootId,
      relativePath: item.relativePath,
      manualUrl: item.manualUrl ?? null,
      uncensoredChoice: item.uncensoredChoice ?? null,
    }));

    const transaction = this.database.sqlite.transaction(() => {
      this.database.db
        .insert(scrapeRuns)
        .values({
          id: runId,
          rootId: input.rootId,
          outputRootId: input.outputRootId ?? null,
          executionMode: input.executionMode,
          createdAt,
        })
        .run();
      this.database.db.insert(scrapeRunItems).values(items).run();
    });
    transaction();
    return await this.getRun(runId);
  }

  async commitFailure(input: CommitScrapeFailureInput): Promise<ScrapeItemOutcomeRecord> {
    requireNonEmpty(input.error, "error");
    return this.commitOutcome({
      id: input.id,
      runId: input.runId,
      itemId: input.itemId,
      attempt: input.attempt,
      outcome: "failed",
      errorMessage: input.error,
      completedAt: input.completedAt ?? new Date(),
    });
  }

  async commitSkipped(input: CommitScrapeSkippedInput): Promise<ScrapeItemOutcomeRecord> {
    return this.commitOutcome({
      id: input.id,
      runId: input.runId,
      itemId: input.itemId,
      attempt: input.attempt,
      outcome: "skipped",
      errorMessage: input.error ?? null,
      completedAt: input.completedAt ?? new Date(),
    });
  }

  async commitSuccess(
    input: CommitScrapeSuccessInput,
  ): Promise<{ outcome: ScrapeItemOutcomeRecord; entry: LibraryEntryRecord }> {
    this.validateSuccessFacts(input);
    const outcomeId = input.id ?? randomUUID();
    const completedAt = input.completedAt ?? new Date();
    const transaction = this.database.sqlite.transaction(() => {
      this.assertCanAppendOutcome(input.runId, input.itemId, input.attempt);
      this.database.db
        .insert(scrapeItemOutcomes)
        .values({
          id: outcomeId,
          runId: input.runId,
          itemId: input.itemId,
          attempt: input.attempt,
          outcome: "success",
          errorMessage: null,
          crawlerDataJson: input.crawlerDataJson,
          nfoRootId: input.nfoRootId ?? null,
          nfoRelativePath: input.nfoRelativePath ?? null,
          outputRootId: input.outputRootId,
          outputRelativePath: input.outputRelativePath,
          uncensoredAmbiguous: input.uncensoredAmbiguous ?? false,
          size: input.size,
          modifiedAt: input.modifiedAt ?? null,
          completedAt,
        })
        .run();
      const entryId = writeLibraryEntry(this.database, {
        ...input.libraryEntry,
        sourceTaskId: input.runId,
        scrapeOutputId: outcomeId,
      });
      return entryId;
    });
    const entryId = transaction();
    const [outcome, entry] = await Promise.all([this.getOutcome(outcomeId), this.library.getEntryById(entryId)]);
    return { outcome, entry };
  }

  async reviseSuccess(
    input: ReviseScrapeSuccessInput,
  ): Promise<{ outcome: ScrapeItemOutcomeRecord; entry: LibraryEntryRecord }> {
    this.validateSuccessFacts(input);
    const transaction = this.database.sqlite.transaction(() => {
      const existing = this.database.db
        .select()
        .from(scrapeItemOutcomes)
        .where(eq(scrapeItemOutcomes.id, input.outcomeId))
        .limit(1)
        .get();
      if (!existing) {
        throw new PersistenceError(persistenceErrorCodes.NotFound, `Scrape outcome not found: ${input.outcomeId}`);
      }
      if (existing.outcome !== "success") {
        throw constraint(`Only successful scrape outcomes can be revised: ${input.outcomeId}`);
      }
      this.database.db
        .update(scrapeItemOutcomes)
        .set({
          crawlerDataJson: input.crawlerDataJson,
          nfoRootId: input.nfoRootId ?? null,
          nfoRelativePath: input.nfoRelativePath ?? null,
          outputRootId: input.outputRootId,
          outputRelativePath: input.outputRelativePath,
          uncensoredAmbiguous: input.uncensoredAmbiguous,
          size: input.size,
          modifiedAt: input.modifiedAt ?? null,
        })
        .where(eq(scrapeItemOutcomes.id, input.outcomeId))
        .run();
      const entryId = writeLibraryEntry(this.database, {
        ...input.libraryEntry,
        sourceTaskId: existing.runId,
        scrapeOutputId: existing.id,
      });
      return entryId;
    });
    const entryId = transaction();
    const [outcome, entry] = await Promise.all([this.getOutcome(input.outcomeId), this.library.getEntryById(entryId)]);
    return { outcome, entry };
  }

  async finalizeRun(input: FinalizeScrapeRunInput): Promise<ScrapeRunSummaryRecord> {
    const completedAt = input.completedAt ?? new Date();
    const transaction = this.database.sqlite.transaction(() => {
      this.assertRunExists(input.runId);
      const itemCount =
        this.database.db
          .select({ value: count() })
          .from(scrapeRunItems)
          .where(eq(scrapeRunItems.runId, input.runId))
          .get()?.value ?? 0;
      const outcomes = this.listLatestOutcomeRows(input.runId);
      if (outcomes.length !== itemCount) {
        throw constraint(
          `Cannot finalize scrape run ${input.runId}: ${itemCount - outcomes.length} item(s) lack an outcome`,
        );
      }

      let successCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      let totalBytes = 0;
      for (const outcome of outcomes) {
        if (outcome.outcome === "success") {
          successCount += 1;
          totalBytes += outcome.size;
        } else if (outcome.outcome === "failed") {
          failedCount += 1;
        } else {
          skippedCount += 1;
        }
      }
      this.validateDisposition(input, { successCount, failedCount, skippedCount });

      this.database.db
        .insert(scrapeRunSummaries)
        .values({
          runId: input.runId,
          disposition: input.disposition,
          startedAt: input.startedAt ?? null,
          completedAt,
          successCount,
          failedCount,
          skippedCount,
          totalBytes,
          outputRootId: input.outputRootId ?? null,
          outputDirectory: input.outputDirectory ?? null,
          errorMessage: input.error ?? null,
        })
        .run();
    });
    transaction();
    const summary = await this.getSummary(input.runId);
    if (!summary) throw new Error(`Scrape run summary disappeared after insert: ${input.runId}`);
    return summary;
  }

  async getRun(runId: string): Promise<ScrapeRunManifest> {
    const row = this.database.db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId)).limit(1).get();
    if (!row) throw new PersistenceError(persistenceErrorCodes.NotFound, `Scrape run not found: ${runId}`);
    const items = this.database.db
      .select()
      .from(scrapeRunItems)
      .where(eq(scrapeRunItems.runId, runId))
      .orderBy(asc(scrapeRunItems.ordinal))
      .all();
    return this.toManifest(row, items);
  }

  async listRuns(): Promise<ScrapeRunManifest[]> {
    const runs = this.database.db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.createdAt)).all();
    const items = this.database.db
      .select()
      .from(scrapeRunItems)
      .orderBy(asc(scrapeRunItems.runId), asc(scrapeRunItems.ordinal))
      .all();
    const itemsByRun = new Map<string, ScrapeRunItemRow[]>();
    for (const item of items) {
      const group = itemsByRun.get(item.runId) ?? [];
      group.push(item);
      itemsByRun.set(item.runId, group);
    }
    return runs.map((run) => this.toManifest(run, itemsByRun.get(run.id) ?? []));
  }

  async getOutcome(outcomeId: string): Promise<ScrapeItemOutcomeRecord> {
    const row = this.database.db
      .select()
      .from(scrapeItemOutcomes)
      .where(eq(scrapeItemOutcomes.id, outcomeId))
      .limit(1)
      .get();
    if (!row) {
      throw new PersistenceError(persistenceErrorCodes.NotFound, `Scrape outcome not found: ${outcomeId}`);
    }
    return toOutcomeRecord(row);
  }

  async listOutcomes(runId?: string): Promise<ScrapeItemOutcomeRecord[]> {
    const rows = runId
      ? this.database.db
          .select()
          .from(scrapeItemOutcomes)
          .where(eq(scrapeItemOutcomes.runId, runId))
          .orderBy(asc(scrapeItemOutcomes.itemId), asc(scrapeItemOutcomes.attempt))
          .all()
      : this.database.db.select().from(scrapeItemOutcomes).orderBy(desc(scrapeItemOutcomes.completedAt)).all();
    return rows.map(toOutcomeRecord);
  }

  async listLatestOutcomes(runId: string): Promise<ScrapeItemOutcomeRecord[]> {
    this.assertRunExists(runId);
    return this.listLatestOutcomeRows(runId).map(toOutcomeRecord);
  }

  async getSummary(runId: string): Promise<ScrapeRunSummaryRecord | null> {
    this.assertRunExists(runId);
    const row = this.database.db
      .select()
      .from(scrapeRunSummaries)
      .where(eq(scrapeRunSummaries.runId, runId))
      .limit(1)
      .get();
    return row ? toSummaryRecord(row) : null;
  }

  async latestSummary(): Promise<ScrapeRunSummaryRecord | null> {
    const row = this.database.db
      .select()
      .from(scrapeRunSummaries)
      .orderBy(desc(scrapeRunSummaries.completedAt))
      .limit(1)
      .get();
    return row ? toSummaryRecord(row) : null;
  }

  private commitOutcome(input: {
    id?: string;
    runId: string;
    itemId: string;
    attempt: number;
    outcome: "failed" | "skipped";
    errorMessage: string | null;
    completedAt: Date;
  }): ScrapeItemOutcomeRecord {
    const id = input.id ?? randomUUID();
    const transaction = this.database.sqlite.transaction(() => {
      this.assertCanAppendOutcome(input.runId, input.itemId, input.attempt);
      this.database.db
        .insert(scrapeItemOutcomes)
        .values({
          id,
          runId: input.runId,
          itemId: input.itemId,
          attempt: input.attempt,
          outcome: input.outcome,
          errorMessage: input.errorMessage,
          crawlerDataJson: null,
          nfoRootId: null,
          nfoRelativePath: null,
          outputRootId: null,
          outputRelativePath: null,
          uncensoredAmbiguous: false,
          size: 0,
          modifiedAt: null,
          completedAt: input.completedAt,
        })
        .run();
      return this.database.db.select().from(scrapeItemOutcomes).where(eq(scrapeItemOutcomes.id, id)).limit(1).get();
    });
    const row = transaction();
    if (!row) throw new Error(`Scrape outcome disappeared after insert: ${id}`);
    return toOutcomeRecord(row);
  }

  private assertCanAppendOutcome(runId: string, itemId: string, attempt: number): void {
    requirePositiveInteger(attempt, "attempt");
    this.assertRunOpen(runId);
    const item = this.database.db
      .select({ runId: scrapeRunItems.runId })
      .from(scrapeRunItems)
      .where(eq(scrapeRunItems.id, itemId))
      .limit(1)
      .get();
    if (!item || item.runId !== runId) {
      throw constraint(`Scrape item does not belong to run ${runId}: ${itemId}`);
    }
    const attempts = this.database.db
      .select({ attempt: scrapeItemOutcomes.attempt })
      .from(scrapeItemOutcomes)
      .where(eq(scrapeItemOutcomes.itemId, itemId))
      .orderBy(desc(scrapeItemOutcomes.attempt))
      .limit(1)
      .get();
    const expectedAttempt = (attempts?.attempt ?? 0) + 1;
    if (attempt !== expectedAttempt) {
      throw constraint(`Expected attempt ${expectedAttempt} for scrape item ${itemId}, received ${attempt}`);
    }
  }

  private assertRunExists(runId: string): void {
    const run = this.database.db.select({ id: scrapeRuns.id }).from(scrapeRuns).where(eq(scrapeRuns.id, runId)).get();
    if (!run) throw new PersistenceError(persistenceErrorCodes.NotFound, `Scrape run not found: ${runId}`);
  }

  private assertRunOpen(runId: string): void {
    this.assertRunExists(runId);
    const summary = this.database.db
      .select({ runId: scrapeRunSummaries.runId })
      .from(scrapeRunSummaries)
      .where(eq(scrapeRunSummaries.runId, runId))
      .get();
    if (summary) throw constraint(`Scrape run is already finalized: ${runId}`);
  }

  private listLatestOutcomeRows(runId: string): ScrapeItemOutcomeRow[] {
    const rows = this.database.db
      .select({ outcome: scrapeItemOutcomes })
      .from(scrapeItemOutcomes)
      .innerJoin(scrapeRunItems, eq(scrapeRunItems.id, scrapeItemOutcomes.itemId))
      .where(eq(scrapeItemOutcomes.runId, runId))
      .orderBy(asc(scrapeRunItems.ordinal), asc(scrapeItemOutcomes.attempt))
      .all();
    const latestByItem = new Map<string, ScrapeItemOutcomeRow>();
    for (const { outcome } of rows) latestByItem.set(outcome.itemId, outcome);
    return [...latestByItem.values()];
  }

  private toManifest(run: ScrapeRunRow, items: ScrapeRunItemRow[]): ScrapeRunManifest {
    return {
      id: run.id,
      rootId: run.rootId,
      outputRootId: run.outputRootId,
      executionMode: run.executionMode,
      createdAt: run.createdAt,
      items: items.map(toItemRecord),
    };
  }

  private validateManifest(input: CreateScrapeRunInput): void {
    requireNonEmpty(input.rootId, "rootId");
    if (input.items.length === 0) throw constraint("A scrape run must contain at least one item");
    const ordinals = new Set<number>();
    const paths = new Set<string>();
    const ids = new Set<string>();
    for (const item of input.items) {
      requireNonNegativeInteger(item.ordinal, "item ordinal");
      requireNonEmpty(item.rootId, "item rootId");
      requireNonEmpty(item.relativePath, "item relativePath");
      if (ordinals.has(item.ordinal)) throw constraint(`Duplicate scrape item ordinal: ${item.ordinal}`);
      ordinals.add(item.ordinal);
      const pathKey = `${item.rootId}\u0000${item.relativePath}`;
      if (paths.has(pathKey)) throw constraint(`Duplicate scrape item path: ${item.rootId}:${item.relativePath}`);
      paths.add(pathKey);
      if (item.id) {
        requireNonEmpty(item.id, "item id");
        if (ids.has(item.id)) throw constraint(`Duplicate scrape item id: ${item.id}`);
        ids.add(item.id);
      }
    }
  }

  private validateSuccessFacts(
    input: Pick<CommitScrapeSuccessInput, "crawlerDataJson" | "outputRootId" | "outputRelativePath" | "size">,
  ): void {
    requireNonEmpty(input.crawlerDataJson, "crawlerDataJson");
    requireNonEmpty(input.outputRootId, "outputRootId");
    requireNonEmpty(input.outputRelativePath, "outputRelativePath");
    requireNonNegativeInteger(input.size, "size");
  }

  private validateDisposition(
    input: FinalizeScrapeRunInput,
    counts: { successCount: number; failedCount: number; skippedCount: number },
  ): void {
    if (input.disposition === "completed" && counts.successCount === 0) {
      throw constraint("A completed scrape run must contain at least one successful item");
    }
    const fatalError = Boolean(input.error?.trim());
    if (input.disposition === "failed" && !fatalError && !(counts.successCount === 0 && counts.failedCount > 0)) {
      throw constraint("A failed scrape run must be all-failed or include a fatal error");
    }
    if (input.disposition === "stopped" && counts.skippedCount === 0) {
      throw constraint("A stopped scrape run must contain at least one skipped item");
    }
  }
}
