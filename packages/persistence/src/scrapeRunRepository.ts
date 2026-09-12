import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import type { LibraryFileInput, LibraryMovieInput, UpsertLibraryEntryInput } from "./libraryRepository";
import { writeLibraryRows } from "./libraryWrite";
import { libraryItemFiles, scrapeAttempts, scrapeItemOutcomes, scrapeRunItems, scrapeRuns } from "./schema";

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
}

export interface ScrapeAttemptRecord {
  id: string;
  itemId: string;
  attempt: number;
  admittedAt: Date;
}

export interface ScrapeItemOutcomeRecord {
  id: string;
  attemptId: string;
  itemId: string;
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

export interface ScrapeRunRecord {
  directoryScopeJson: string | null;
  configurationJson: string | null;
  manifestFixedAt: Date | null;
  discoveryJson: string | null;
  id: string;
  executionGeneration: number;
  revision: number;
  rootId: string;
  requestedOutputRootId: string | null;
  requestedOutputRelativeDirectory: string | null;
  executionMode: ScrapeExecutionMode;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  disposition: ScrapeRunDisposition | null;
  error: string | null;
  items: ScrapeRunItemRecord[];
  attempts: ScrapeAttemptRecord[];
  outcomes: ScrapeItemOutcomeRecord[];
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
  directoryScopeJson?: string;
  configurationJson?: string;
  id?: string;
  rootId: string;
  outputRootId?: string | null;
  outputRelativeDirectory?: string | null;
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

type CommitBase = {
  id?: string;
  attemptId: string;
  completedAt?: Date;
};

export type CommitScrapeOutcomeInput =
  | (CommitBase & { outcome: "failed"; error: string })
  | (CommitBase & { outcome: "skipped"; error?: string | null })
  | (CommitBase & {
      outcome: "success";
      error?: string | null;
      crawlerDataJson: string;
      nfoRootId?: string | null;
      nfoRelativePath?: string | null;
      outputRootId: string;
      outputRelativePath: string;
      uncensoredAmbiguous?: boolean;
      size: number;
      modifiedAt?: Date | null;
      libraryEntry: LibraryFileInput;
    });

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
  discoveryJson?: string;
  runId: string;
  revision?: number;
  disposition: ScrapeRunDisposition;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date;
}

const notFound = (entity: string, id: string): PersistenceError =>
  new PersistenceError(persistenceErrorCodes.NotFound, `${entity} not found: ${id}`);

const latestOutcomes = (outcomes: readonly ScrapeItemOutcomeRecord[]): ScrapeItemOutcomeRecord[] => {
  const latest = new Map<string, ScrapeItemOutcomeRecord>();
  for (const outcome of outcomes) latest.set(outcome.itemId, outcome);
  return [...latest.values()];
};

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
      if (input.items.length)
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
            })),
          )
          .run();
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
    const attempts = this.database.db
      .select({ attempt: scrapeAttempts })
      .from(scrapeAttempts)
      .innerJoin(scrapeRunItems, eq(scrapeRunItems.id, scrapeAttempts.itemId))
      .where(eq(scrapeRunItems.runId, runId))
      .orderBy(asc(scrapeRunItems.ordinal), asc(scrapeAttempts.attempt))
      .all();
    const outcomes = this.database.db
      .select({ outcome: scrapeItemOutcomes, attempt: scrapeAttempts })
      .from(scrapeItemOutcomes)
      .innerJoin(scrapeAttempts, eq(scrapeAttempts.id, scrapeItemOutcomes.attemptId))
      .innerJoin(scrapeRunItems, eq(scrapeRunItems.id, scrapeAttempts.itemId))
      .where(eq(scrapeRunItems.runId, runId))
      .orderBy(asc(scrapeRunItems.ordinal), asc(scrapeAttempts.attempt))
      .all();
    return {
      directoryScopeJson: run.directoryScopeJson,
      configurationJson: run.configurationJson,
      manifestFixedAt: run.manifestFixedAt,
      discoveryJson: run.discoveryJson,
      id: run.id,
      executionGeneration: run.executionGeneration,
      revision: run.revision,
      rootId: run.rootId,
      requestedOutputRootId: run.outputRootId,
      requestedOutputRelativeDirectory: run.outputRelativeDirectory,
      executionMode: run.executionMode,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      disposition: run.disposition,
      error: run.errorMessage,
      items,
      attempts: attempts.map(({ attempt }) => attempt),
      outcomes: outcomes.map(({ outcome, attempt }) => ({
        id: outcome.id,
        attemptId: outcome.attemptId,
        itemId: attempt.itemId,
        outcome: outcome.outcome,
        error: outcome.errorMessage,
        crawlerDataJson: outcome.crawlerDataJson,
        nfoRootId: outcome.nfoRootId,
        nfoRelativePath: outcome.nfoRelativePath,
        outputRootId: outcome.outputRootId,
        outputRelativePath: outcome.outputRelativePath,
        uncensoredAmbiguous: outcome.uncensoredAmbiguous,
        size: outcome.size,
        modifiedAt: outcome.modifiedAt,
        completedAt: outcome.completedAt,
      })),
    };
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
      if (!run || run.disposition || run.manifestFixedAt || !run.directoryScopeJson)
        throw new Error(`Cannot fix scrape manifest: ${input.runId}`);
      if (input.items.length)
        this.database.db
          .insert(scrapeRunItems)
          .values(
            input.items.map((item) => ({
              ...item,
              id: item.id ?? randomUUID(),
              runId: input.runId,
            })),
          )
          .run();
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

  admitAttempt(itemId: string, admittedAt = new Date()): ScrapeAttemptRecord {
    const item = this.database.db.select().from(scrapeRunItems).where(eq(scrapeRunItems.id, itemId)).get();
    if (!item) throw notFound("Scrape item", itemId);
    const run = this.database.db.select().from(scrapeRuns).where(eq(scrapeRuns.id, item.runId)).get();
    if (!run) throw notFound("Scrape run", item.runId);
    if (run.disposition === "interrupted") throw new Error(`Interrupted scrape run cannot admit attempts: ${run.id}`);

    const latest = this.database.db
      .select()
      .from(scrapeAttempts)
      .where(eq(scrapeAttempts.itemId, itemId))
      .orderBy(desc(scrapeAttempts.attempt))
      .limit(1)
      .get();
    if (latest) {
      const outcome = this.database.db
        .select({ id: scrapeItemOutcomes.id })
        .from(scrapeItemOutcomes)
        .where(eq(scrapeItemOutcomes.attemptId, latest.id))
        .get();
      if (!outcome) throw new Error(`Scrape item already has an unfinished attempt: ${itemId}`);
    }

    const attempt = {
      id: randomUUID(),
      itemId,
      attempt: (latest?.attempt ?? 0) + 1,
      admittedAt,
    };
    this.database.db.insert(scrapeAttempts).values(attempt).run();
    return attempt;
  }

  commitOutcome(input: Extract<CommitScrapeOutcomeInput, { outcome: "failed" | "skipped" }>): ScrapeItemOutcomeRecord {
    const id = input.id ?? randomUUID();
    const completedAt = input.completedAt ?? new Date();
    const { attempt } = this.requireOpenAttempt(input.attemptId);
    this.database.db
      .insert(scrapeItemOutcomes)
      .values({
        id,
        attemptId: attempt.id,
        outcome: input.outcome,
        errorMessage: input.error ?? null,
        crawlerDataJson: null,
        nfoRootId: null,
        nfoRelativePath: null,
        outputRootId: null,
        outputRelativePath: null,
        uncensoredAmbiguous: false,
        size: 0,
        modifiedAt: null,
        completedAt,
      })
      .run();
    return {
      id,
      attemptId: attempt.id,
      itemId: attempt.itemId,
      outcome: input.outcome,
      error: input.error ?? null,
      crawlerDataJson: null,
      nfoRootId: null,
      nfoRelativePath: null,
      outputRootId: null,
      outputRelativePath: null,
      uncensoredAmbiguous: false,
      size: 0,
      modifiedAt: null,
      completedAt,
    };
  }

  commitSuccessOutcomes(
    inputs: readonly Extract<CommitScrapeOutcomeInput, { outcome: "success" }>[],
    movie: LibraryMovieInput,
  ): Array<{
    outcomeId: string;
    entryId: string;
  }> {
    if (inputs.length === 0) throw new Error("Scrape success batch must not be empty");
    return this.database.sqlite.transaction(() => {
      const outcomes = inputs.map((input) => this.writeSuccessOutcome(input));
      const owners = new Set(outcomes.flatMap((outcome) => (outcome.ownerId ? [outcome.ownerId] : [])));
      if (movie.id) owners.add(movie.id);
      if (owners.size > 1) throw new Error("Scrape success group must target one movie");
      const entryId = writeLibraryRows(
        this.database,
        { ...movie, id: [...owners][0] },
        outcomes.map(({ libraryEntry }) => libraryEntry),
      );
      return outcomes.map(({ outcomeId }) => ({ outcomeId, entryId }));
    })();
  }

  private writeSuccessOutcome(input: Extract<CommitScrapeOutcomeInput, { outcome: "success" }>): {
    outcomeId: string;
    ownerId?: string;
    libraryEntry: LibraryFileInput;
  } {
    const id = input.id ?? randomUUID();
    const completedAt = input.completedAt ?? new Date();
    const { item, attempt } = this.requireOpenAttempt(input.attemptId);
    this.database.db
      .insert(scrapeItemOutcomes)
      .values({
        id,
        attemptId: attempt.id,
        outcome: "success",
        errorMessage: input.error ?? null,
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
    const previousFile = this.database.db
      .select()
      .from(libraryItemFiles)
      .where(and(eq(libraryItemFiles.rootId, item.rootId), eq(libraryItemFiles.rootRelativePath, item.relativePath)))
      .get();
    return {
      outcomeId: id,
      ownerId: previousFile?.itemId,
      libraryEntry: {
        ...input.libraryEntry,
        fileId: input.libraryEntry.fileId ?? previousFile?.id,
        sourceOutcomeId: id,
      },
    };
  }

  /**
   * Synchronous so hosts can run it inside the publication journal commit
   * transaction: shared-NFO parts revise together or not at all.
   */
  reviseSuccess(inputs: readonly ReviseScrapeSuccessInput[]): void {
    this.database.sqlite.transaction(() => {
      const libraryEntries: UpsertLibraryEntryInput[] = [];
      for (const input of inputs) {
        const existing = this.database.db
          .select()
          .from(scrapeItemOutcomes)
          .where(eq(scrapeItemOutcomes.id, input.outcomeId))
          .get();
        if (!existing) throw notFound("Scrape outcome", input.outcomeId);
        if (existing.outcome !== "success") {
          throw new Error(`Only successful scrape outcomes can be revised: ${input.outcomeId}`);
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
        libraryEntries.push({
          ...input.libraryEntry,
          sourceOutcomeId: existing.id,
        });
      }
      const movie = libraryEntries[0];
      if (movie) {
        if (new Set(libraryEntries.map((entry) => entry.id)).size !== 1)
          throw new Error("Scrape revision group must target one movie");
        writeLibraryRows(this.database, movie, libraryEntries);
      }
    })();
  }

  async finalize(input: FinalizeScrapeRunInput): Promise<ScrapeRunRecord> {
    const run = await this.get(input.runId);
    const outcomeByAttemptId = new Map(run.outcomes.map((outcome) => [outcome.attemptId, outcome]));
    const latestAttemptByItemId = new Map(run.attempts.map((attempt) => [attempt.itemId, attempt]));
    const settledItems = run.items.filter((item) => {
      const attempt = latestAttemptByItemId.get(item.id);
      return attempt && outcomeByAttemptId.has(attempt.id);
    }).length;
    if (
      (input.disposition === "completed" && (!run.manifestFixedAt || settledItems !== run.items.length)) ||
      (input.disposition !== "interrupted" && run.attempts.some((attempt) => !outcomeByAttemptId.has(attempt.id)))
    ) {
      throw new Error(
        `Cannot finalize scrape run ${run.id}: ${run.items.length - settledItems} item(s) lack an outcome`,
      );
    }
    const latest = latestOutcomes(run.outcomes);
    const projectedDisposition =
      input.disposition === "interrupted"
        ? "interrupted"
        : input.disposition === "stopped"
          ? "stopped"
          : input.disposition === "failed" || latest.some((outcome) => outcome.outcome !== "success")
            ? "failed"
            : "completed";
    this.database.db
      .update(scrapeRuns)
      .set({
        disposition: projectedDisposition,
        ...(input.discoveryJson ? { discoveryJson: input.discoveryJson } : {}),
        revision: input.revision ?? run.revision + 1,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? new Date(),
        errorMessage: input.error ?? null,
      })
      .where(eq(scrapeRuns.id, run.id))
      .run();
    return await this.get(run.id);
  }

  interruptUnfinished(interruptedAt = new Date()): void {
    const runIds = new Set(
      this.database.db
        .select({ id: scrapeRuns.id })
        .from(scrapeRuns)
        .where(isNull(scrapeRuns.disposition))
        .all()
        .map(({ id }) => id),
    );
    for (const { id } of this.database.db
      .selectDistinct({ id: scrapeRunItems.runId })
      .from(scrapeAttempts)
      .innerJoin(scrapeRunItems, eq(scrapeRunItems.id, scrapeAttempts.itemId))
      .leftJoin(scrapeItemOutcomes, eq(scrapeItemOutcomes.attemptId, scrapeAttempts.id))
      .where(isNull(scrapeItemOutcomes.id))
      .all()) {
      runIds.add(id);
    }
    this.database.sqlite.transaction(() => {
      for (const id of runIds) {
        this.database.db
          .update(scrapeRuns)
          .set({
            disposition: "interrupted",
            completedAt: interruptedAt,
            errorMessage: "Interrupted by shutdown",
            executionGeneration: sql`${scrapeRuns.executionGeneration} + 1`,
            revision: 0,
          })
          .where(eq(scrapeRuns.id, id))
          .run();
      }
    })();
  }

  async rerunDirectory(runId: string): Promise<ScrapeRunRecord> {
    const run = await this.get(runId);
    if (!run.disposition || !run.directoryScopeJson || !run.configurationJson)
      throw new Error(`Directory run cannot be rerun: ${runId}`);
    return await this.create({
      rootId: run.rootId,
      outputRootId: run.requestedOutputRootId,
      outputRelativeDirectory: run.requestedOutputRelativeDirectory,
      executionMode: "batch",
      directoryScopeJson: run.directoryScopeJson,
      configurationJson: run.configurationJson,
      items: [],
    });
  }

  async retry(runId: string, itemIds?: readonly string[], admittedAt = new Date()): Promise<ScrapeRunRecord> {
    const run = await this.get(runId);
    if (run.directoryScopeJson && !run.manifestFixedAt && run.disposition && !itemIds) {
      return await this.rerunDirectory(runId);
    }
    if (!run.disposition || run.disposition === "interrupted") {
      throw new Error(`Only completed, failed, or stopped scrape runs can be retried: ${run.id}`);
    }
    const outcomesByItemId = new Map(latestOutcomes(run.outcomes).map((outcome) => [outcome.itemId, outcome]));
    const items = itemIds
      ? (() => {
          const selectedIds = new Set(itemIds);
          if (selectedIds.size === 0) throw new Error(`Scrape retry requires at least one item: ${run.id}`);
          const unknownItemId = [...selectedIds].find((itemId) => !run.items.some((item) => item.id === itemId));
          if (unknownItemId) throw new Error(`Scrape item does not belong to run ${run.id}: ${unknownItemId}`);
          return run.items.filter((item) => selectedIds.has(item.id));
        })()
      : run.items.filter((item) => {
          const outcome = outcomesByItemId.get(item.id);
          return !outcome || outcome.outcome === "failed" || outcome.outcome === "skipped";
        });
    if (items.length === 0) throw new Error(`Scrape run has no failed or skipped items to retry: ${run.id}`);
    this.database.sqlite.transaction(() => {
      for (const item of items) this.admitAttempt(item.id, admittedAt);
      this.database.db
        .update(scrapeRuns)
        .set({
          executionGeneration: run.executionGeneration + 1,
          revision: 0,
          disposition: null,
          completedAt: null,
          errorMessage: null,
        })
        .where(eq(scrapeRuns.id, run.id))
        .run();
    })();
    return await this.get(run.id);
  }

  summary(run: ScrapeRunRecord): ScrapeRunSummaryRecord | null {
    if (!run.disposition || !run.completedAt) return null;
    const outcomes = latestOutcomes(run.outcomes);
    const outputRootIds = new Set(
      outcomes
        .filter((outcome) => outcome.outcome === "success")
        .map((outcome) => outcome.outputRootId)
        .filter((rootId): rootId is string => Boolean(rootId)),
    );
    return {
      runId: run.id,
      disposition: run.disposition,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      successCount: outcomes.filter((outcome) => outcome.outcome === "success").length,
      failedCount: outcomes.filter((outcome) => outcome.outcome === "failed").length,
      skippedCount: outcomes.filter((outcome) => outcome.outcome === "skipped").length,
      totalBytes: outcomes.reduce((total, outcome) => total + (outcome.outcome === "success" ? outcome.size : 0), 0),
      outputRootId: outputRootIds.size === 1 ? [...outputRootIds][0] : null,
      error: run.error,
    };
  }

  latestOutcomes(run: ScrapeRunRecord): ScrapeItemOutcomeRecord[] {
    return latestOutcomes(run.outcomes);
  }

  private requireOpenAttempt(attemptId: string) {
    const attempt = this.database.db.select().from(scrapeAttempts).where(eq(scrapeAttempts.id, attemptId)).get();
    if (!attempt) throw notFound("Scrape attempt", attemptId);
    const item = this.database.db.select().from(scrapeRunItems).where(eq(scrapeRunItems.id, attempt.itemId)).get();
    if (!item) throw notFound("Scrape item", attempt.itemId);
    const outcome = this.database.db
      .select({ id: scrapeItemOutcomes.id })
      .from(scrapeItemOutcomes)
      .where(eq(scrapeItemOutcomes.attemptId, attempt.id))
      .get();
    if (outcome) throw new Error(`Scrape attempt already has an outcome: ${attempt.id}`);
    return { item, attempt };
  }
}
