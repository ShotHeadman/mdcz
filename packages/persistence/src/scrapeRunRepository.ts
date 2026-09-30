import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableColumns, isNotNull, isNull } from "drizzle-orm";
import type { PersistenceDatabase } from "./database";
import { PersistenceError, persistenceErrorCodes } from "./errors";
import { scrapeRuns } from "./schema";

export type ScrapeExecutionMode = "single" | "batch";
export type ScrapeUncensoredChoice = "umr" | "leak" | "uncensored";
export type ScrapeTerminalOutcome = "success" | "failed" | "skipped";
export type ScrapeRunDisposition = "completed" | "failed" | "stopped" | "interrupted";

export interface ScrapeRunManifestItem {
  id: string;
  ordinal: number;
  rootId: string;
  relativePath: string;
  manualUrl?: string | null;
  uncensoredChoice?: ScrapeUncensoredChoice | null;
}

export type ScrapeRunItemRecord = ScrapeRunManifestItem;

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
  totalItems: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  totalBytes: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  disposition: ScrapeRunDisposition | null;
  error: string | null;
  items: ScrapeRunManifestItem[];
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

export interface FinalizeScrapeRunInput {
  runId: string;
  disposition: ScrapeRunDisposition;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date;
  discoveryJson?: string;
  successCount?: number;
  failedCount?: number;
  skippedCount?: number;
  totalBytes?: number;
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
    const manifestItems: ScrapeRunManifestItem[] = input.items.map((item) => ({
      id: item.id ?? randomUUID(),
      ordinal: item.ordinal,
      rootId: item.rootId,
      relativePath: item.relativePath,
      manualUrl: item.manualUrl ?? null,
      uncensoredChoice: item.uncensoredChoice ?? null,
    }));

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
        manifestJson: manifestItems.length > 0 ? JSON.stringify(manifestItems) : null,
        totalItems: manifestItems.length,
        manifestFixedAt: input.directoryScopeJson ? null : createdAt,
        createdAt,
      })
      .run();

    return await this.get(id);
  }

  async get(runId: string): Promise<ScrapeRunRecord> {
    const run = this.database.db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId)).get();
    if (!run) throw notFound("Scrape run", runId);

    const items = run.manifestJson ? (JSON.parse(run.manifestJson) as ScrapeRunManifestItem[]) : [];

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
      totalItems: run.totalItems,
      successCount: run.successCount,
      failedCount: run.failedCount,
      skippedCount: run.skippedCount,
      totalBytes: run.totalBytes,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      disposition: run.disposition,
      error: run.errorMessage,
      items,
    };
  }

  async fixManifest(input: {
    runId: string;
    items: CreateScrapeRunInput["items"];
    discoveryJson: string;
    signal: AbortSignal;
  }): Promise<ScrapeRunRecord> {
    input.signal.throwIfAborted();
    const run = this.database.db.select().from(scrapeRuns).where(eq(scrapeRuns.id, input.runId)).get();
    if (!run || run.disposition || run.manifestFixedAt || !run.directoryScopeJson) {
      throw new Error(`Cannot fix scrape manifest: ${input.runId}`);
    }
    const manifestItems: ScrapeRunManifestItem[] = input.items.map((item) => ({
      id: item.id ?? randomUUID(),
      ordinal: item.ordinal,
      rootId: item.rootId,
      relativePath: item.relativePath,
      manualUrl: item.manualUrl ?? null,
      uncensoredChoice: item.uncensoredChoice ?? null,
    }));

    this.database.db
      .update(scrapeRuns)
      .set({
        manifestFixedAt: new Date(),
        discoveryJson: input.discoveryJson,
        manifestJson: manifestItems.length > 0 ? JSON.stringify(manifestItems) : null,
        totalItems: manifestItems.length,
      })
      .where(eq(scrapeRuns.id, input.runId))
      .run();

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

  listHistory(runId?: string): Omit<ScrapeRunRecord, "items">[] {
    const { manifestJson: _manifest, ...fields } = getTableColumns(scrapeRuns);
    const rows = this.database.db
      .select(fields)
      .from(scrapeRuns)
      .where(runId ? eq(scrapeRuns.id, runId) : undefined)
      .orderBy(desc(scrapeRuns.createdAt))
      .all();
    if (runId && !rows.length) throw notFound("Scrape run", runId);
    return rows.map(({ outputRootId, outputRelativeDirectory, errorMessage, ...run }) => ({
      ...run,
      requestedOutputRootId: outputRootId,
      requestedOutputRelativeDirectory: outputRelativeDirectory,
      error: errorMessage,
    }));
  }

  async finalize(input: FinalizeScrapeRunInput): Promise<ScrapeRunRecord> {
    const run = await this.get(input.runId);
    if (input.disposition === "completed" && !run.manifestFixedAt) {
      throw new Error(`Cannot finalize scrape run ${run.id}: manifest is not fixed`);
    }
    const successCount = input.successCount ?? run.successCount;
    const failedCount = input.failedCount ?? run.failedCount;
    const skippedCount = input.skippedCount ?? run.skippedCount;
    const totalBytes = input.totalBytes ?? run.totalBytes;
    const projectedDisposition =
      input.disposition === "interrupted"
        ? "interrupted"
        : input.disposition === "stopped"
          ? "stopped"
          : input.disposition === "failed" || failedCount > 0
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
        successCount,
        failedCount,
        skippedCount,
        totalBytes,
      })
      .where(eq(scrapeRuns.id, run.id))
      .run();

    return await this.get(run.id);
  }

  interruptUnfinished(interruptedAt = new Date()): void {
    this.database.db
      .update(scrapeRuns)
      .set({
        disposition: "interrupted",
        completedAt: interruptedAt,
        errorMessage: "Interrupted by shutdown",
      })
      .where(isNull(scrapeRuns.disposition))
      .run();
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

  summary(run: Omit<ScrapeRunRecord, "items">): ScrapeRunSummaryRecord | null {
    if (!run.disposition || !run.completedAt) return null;
    return {
      runId: run.id,
      disposition: run.disposition,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      successCount: run.successCount,
      failedCount: run.failedCount,
      skippedCount: run.skippedCount,
      totalBytes: run.totalBytes,
      outputRootId: run.requestedOutputRootId,
      error: run.error,
    };
  }
}
