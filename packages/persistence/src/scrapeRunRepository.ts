import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { type LibraryEntryRecord, LibraryRepository, type UpsertLibraryEntryInput } from "./libraryRepository";
import { writeLibraryEntry } from "./libraryWrite";
import { scrapeItemOutcomes, scrapeRunItems, scrapeRuns } from "./schema";

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

export interface ScrapeItemOutcomeRecord {
  id: string;
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
  outcomes: ScrapeItemOutcomeRecord[];
}

export type ScrapeRunManifest = ScrapeRunRecord;

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
  itemId: string;
  attempt: number;
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
    const outcomes = this.database.db
      .select({ outcome: scrapeItemOutcomes })
      .from(scrapeItemOutcomes)
      .innerJoin(scrapeRunItems, eq(scrapeRunItems.id, scrapeItemOutcomes.itemId))
      .where(eq(scrapeRunItems.runId, runId))
      .orderBy(asc(scrapeRunItems.ordinal), asc(scrapeItemOutcomes.attempt))
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
      outcomes: outcomes.map(({ outcome }) => ({
        id: outcome.id,
        itemId: outcome.itemId,
        attempt: outcome.attempt,
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

  async list(): Promise<ScrapeRunRecord[]> {
    const ids = this.database.db
      .select({ id: scrapeRuns.id })
      .from(scrapeRuns)
      .orderBy(desc(scrapeRuns.createdAt))
      .all();
    return await Promise.all(ids.map(({ id }) => this.get(id)));
  }

  async commitOutcome(input: Extract<CommitScrapeOutcomeInput, { outcome: "success" }>): Promise<{
    outcome: ScrapeItemOutcomeRecord;
    entry: LibraryEntryRecord;
  }>;
  async commitOutcome(
    input: Extract<CommitScrapeOutcomeInput, { outcome: "failed" | "skipped" }>,
  ): Promise<ScrapeItemOutcomeRecord>;
  async commitOutcome(
    input: CommitScrapeOutcomeInput,
  ): Promise<ScrapeItemOutcomeRecord | { outcome: ScrapeItemOutcomeRecord; entry: LibraryEntryRecord }> {
    const id = input.id ?? randomUUID();
    const completedAt = input.completedAt ?? new Date();
    const item = this.database.db.select().from(scrapeRunItems).where(eq(scrapeRunItems.id, input.itemId)).get();
    if (!item) throw notFound("Scrape item", input.itemId);
    const run = this.database.db.select().from(scrapeRuns).where(eq(scrapeRuns.id, item.runId)).get();
    if (!run) throw notFound("Scrape run", item.runId);
    if (run.disposition) throw new Error(`Scrape run is already finalized: ${run.id}`);
    const previous = this.database.db
      .select({ attempt: scrapeItemOutcomes.attempt })
      .from(scrapeItemOutcomes)
      .where(eq(scrapeItemOutcomes.itemId, item.id))
      .orderBy(desc(scrapeItemOutcomes.attempt))
      .get();
    const expectedAttempt = (previous?.attempt ?? 0) + 1;
    if (input.attempt !== expectedAttempt) {
      throw new Error(`Expected attempt ${expectedAttempt} for scrape item ${item.id}, received ${input.attempt}`);
    }

    let entryId: string | null = null;
    this.database.sqlite.transaction(() => {
      this.database.db
        .insert(scrapeItemOutcomes)
        .values({
          id,
          itemId: item.id,
          attempt: input.attempt,
          outcome: input.outcome,
          errorMessage: input.outcome === "success" ? null : (input.error ?? null),
          crawlerDataJson: input.outcome === "success" ? input.crawlerDataJson : null,
          nfoRootId: input.outcome === "success" ? (input.nfoRootId ?? null) : null,
          nfoRelativePath: input.outcome === "success" ? (input.nfoRelativePath ?? null) : null,
          outputRootId: input.outcome === "success" ? input.outputRootId : null,
          outputRelativePath: input.outcome === "success" ? input.outputRelativePath : null,
          uncensoredAmbiguous: input.outcome === "success" ? (input.uncensoredAmbiguous ?? false) : false,
          size: input.outcome === "success" ? input.size : 0,
          modifiedAt: input.outcome === "success" ? (input.modifiedAt ?? null) : null,
          completedAt,
        })
        .run();
      if (input.outcome === "success") {
        entryId = writeLibraryEntry(this.database, {
          ...input.libraryEntry,
          sourceRunId: item.runId,
          sourceOutcomeId: id,
        });
      }
    })();
    const outcome = (await this.get(item.runId)).outcomes.find((candidate) => candidate.id === id);
    if (!outcome) throw new Error(`Scrape outcome disappeared after insert: ${id}`);
    return entryId ? { outcome, entry: await this.library.getEntryById(entryId) } : outcome;
  }

  async reviseSuccess(
    input: ReviseScrapeSuccessInput,
  ): Promise<{ outcome: ScrapeItemOutcomeRecord; entry: LibraryEntryRecord }> {
    const existing = this.database.db
      .select({ outcome: scrapeItemOutcomes, item: scrapeRunItems })
      .from(scrapeItemOutcomes)
      .innerJoin(scrapeRunItems, eq(scrapeRunItems.id, scrapeItemOutcomes.itemId))
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
      return writeLibraryEntry(this.database, {
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
    if (run.disposition) throw new Error(`Scrape run is already finalized: ${run.id}`);
    if (latestOutcomes(run.outcomes).length !== run.items.length) {
      throw new Error(
        `Cannot finalize scrape run ${run.id}: ${run.items.length - latestOutcomes(run.outcomes).length} item(s) lack an outcome`,
      );
    }
    const outputRootIds = new Set(
      latestOutcomes(run.outcomes)
        .filter((outcome) => outcome.outcome === "success")
        .map((outcome) => outcome.outputRootId)
        .filter((rootId): rootId is string => Boolean(rootId)),
    );
    this.database.db
      .update(scrapeRuns)
      .set({
        disposition: input.disposition,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? new Date(),
        outputRootId: outputRootIds.size === 1 ? [...outputRootIds][0] : null,
        errorMessage: input.error ?? null,
      })
      .where(eq(scrapeRuns.id, run.id))
      .run();
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
}
