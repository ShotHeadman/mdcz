import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { type LibraryEntryRecord, LibraryRepository, type UpsertLibraryEntryInput } from "./libraryRepository";
import { writeLibraryRows } from "./libraryWrite";
import { scrapeAttempts, scrapeItemOutcomes, scrapeRunItems, scrapeRuns } from "./schema";

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
  id: string;
  rootId: string;
  requestedOutputRootId: string | null;
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
      crawlerDataJson: string;
      nfoRootId?: string | null;
      nfoRelativePath?: string | null;
      outputRootId: string;
      outputRelativePath: string;
      uncensoredAmbiguous?: boolean;
      size: number;
      modifiedAt?: Date | null;
      libraryEntry: UpsertLibraryEntryInput;
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
  runId: string;
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
  private readonly library: LibraryRepository;

  constructor(private readonly database: PersistenceDatabase) {
    this.library = new LibraryRepository(database);
  }

  async create(input: CreateScrapeRunInput): Promise<ScrapeRunRecord> {
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date();
    this.database.sqlite.transaction(() => {
      this.database.db
        .insert(scrapeRuns)
        .values({
          id,
          rootId: input.rootId,
          outputRootId: input.outputRootId ?? null,
          executionMode: input.executionMode,
          createdAt,
        })
        .run();
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
      id: run.id,
      rootId: run.rootId,
      requestedOutputRootId: run.outputRootId,
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

  commitSuccessOutcome(input: Extract<CommitScrapeOutcomeInput, { outcome: "success" }>): {
    outcomeId: string;
    entryId: string;
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
    return {
      outcomeId: id,
      entryId: writeLibraryRows(this.database, {
        ...input.libraryEntry,
        sourceRunId: item.runId,
        sourceOutcomeId: id,
      }),
    };
  }

  async reviseSuccess(
    input: ReviseScrapeSuccessInput,
  ): Promise<{ outcome: ScrapeItemOutcomeRecord; entry: LibraryEntryRecord }> {
    const existing = this.database.db
      .select({ outcome: scrapeItemOutcomes, item: scrapeRunItems })
      .from(scrapeItemOutcomes)
      .innerJoin(scrapeAttempts, eq(scrapeAttempts.id, scrapeItemOutcomes.attemptId))
      .innerJoin(scrapeRunItems, eq(scrapeRunItems.id, scrapeAttempts.itemId))
      .where(eq(scrapeItemOutcomes.id, input.outcomeId))
      .get();
    if (!existing) throw notFound("Scrape outcome", input.outcomeId);
    if (existing.outcome.outcome !== "success")
      throw new Error(`Only successful scrape outcomes can be revised: ${input.outcomeId}`);
    const entryId = this.database.sqlite.transaction(() => {
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
      return writeLibraryRows(this.database, {
        ...input.libraryEntry,
        sourceRunId: existing.item.runId,
        sourceOutcomeId: existing.outcome.id,
      });
    })();
    const outcome = (await this.get(existing.item.runId)).outcomes.find(
      (candidate) => candidate.id === input.outcomeId,
    );
    if (!outcome) throw new Error(`Scrape outcome disappeared after revision: ${input.outcomeId}`);
    return { outcome, entry: await this.library.getEntryById(entryId) };
  }

  async finalize(input: FinalizeScrapeRunInput): Promise<ScrapeRunRecord> {
    const run = await this.get(input.runId);
    const outcomeByAttemptId = new Map(run.outcomes.map((outcome) => [outcome.attemptId, outcome]));
    const latestAttemptByItemId = new Map(run.attempts.map((attempt) => [attempt.itemId, attempt]));
    const settledItems = run.items.filter((item) => {
      const attempt = latestAttemptByItemId.get(item.id);
      return attempt && outcomeByAttemptId.has(attempt.id);
    }).length;
    if (input.disposition !== "interrupted" && settledItems !== run.items.length) {
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
          : latest.some((outcome) => outcome.outcome !== "success")
            ? "failed"
            : "completed";
    const outputRootIds = new Set(
      latest
        .filter((outcome) => outcome.outcome === "success")
        .map((outcome) => outcome.outputRootId)
        .filter((rootId): rootId is string => Boolean(rootId)),
    );
    this.database.db
      .update(scrapeRuns)
      .set({
        disposition: projectedDisposition,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? new Date(),
        outputRootId: outputRootIds.size === 1 ? [...outputRootIds][0] : null,
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
          .set({ disposition: "interrupted", completedAt: interruptedAt, errorMessage: "Interrupted by shutdown" })
          .where(eq(scrapeRuns.id, id))
          .run();
      }
    })();
  }

  async retry(runId: string, admittedAt = new Date()): Promise<ScrapeRunRecord> {
    const run = await this.get(runId);
    if (!run.disposition || run.disposition === "interrupted") {
      throw new Error(`Only completed, failed, or stopped scrape runs can be retried: ${run.id}`);
    }
    const outcomesByItemId = new Map(latestOutcomes(run.outcomes).map((outcome) => [outcome.itemId, outcome]));
    const items = run.items.filter((item) => {
      const outcome = outcomesByItemId.get(item.id);
      return outcome?.outcome === "failed" || outcome?.outcome === "skipped";
    });
    if (items.length === 0) throw new Error(`Scrape run has no failed or skipped items to retry: ${run.id}`);
    this.database.sqlite.transaction(() => {
      for (const item of items) this.admitAttempt(item.id, admittedAt);
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
