import type { DiscoveryProgress } from "@mdcz/shared/directoryTasks";
import { runtimeLoggerService } from "../../shared";
import {
  type ScrapeRunExecution,
  type ScrapeRunItem,
  type ScrapeRunLogEntry,
  ScrapeRunSession,
  type ScrapeRunSnapshot,
  type ScrapeRunStageSnapshot,
} from "./ScrapeRunSession";

export type ScrapeWorkflowDisposition = "completed" | "failed" | "stopped" | "interrupted";

export interface ScrapeRunStore<TRun> {
  rerunDirectory(runId: string): Promise<TRun>;
  finalize(input: {
    discoveryJson?: string;
    runId: string;
    disposition: ScrapeWorkflowDisposition;
    error?: string | null;
    startedAt?: Date | null;
    successCount?: number;
    failedCount?: number;
    skippedCount?: number;
    totalBytes?: number;
  }): Promise<TRun>;
  interruptUnfinished(interruptedAt?: Date): void | Promise<void>;
}

export interface ScrapeWorkflowReporter {
  progress(itemId: string, percent: number): void;
  stage(stage: Omit<ScrapeRunStageSnapshot, "itemId" | "relativePath"> & { itemId?: string | null }): void;
}

export interface ScrapeHostPort<TStart, TRun, TItem extends ScrapeRunItem = ScrapeRunItem, TPrepared = unknown> {
  create(input: TStart): Promise<TRun>;
  retry?(runId: string, itemIds?: readonly string[]): Promise<TRun>;
  runId(run: TRun): string;
  describe(run: TRun): { totalItems: number | null };
  discover?(run: TRun, signal: AbortSignal, onProgress: (progress: DiscoveryProgress) => void): Promise<TRun>;
  createExecution(
    run: TRun,
    reporter: ScrapeWorkflowReporter,
    signal?: AbortSignal,
  ): Promise<ScrapeRunExecution<TItem, TPrepared>>;
  onInvalidate(runs: Array<{ run: TRun; snapshot: ScrapeRunSnapshot<TItem>; startedAt: Date | null }>): void;
  onTerminal?(run: TRun, snapshot: ScrapeRunSnapshot<TItem>): Promise<void> | void;
  onError?(runId: string, error: unknown): Promise<void> | void;
}

type WorkflowEntry<TRun, TItem extends ScrapeRunItem, TPrepared> = {
  id: string;
  run: TRun;
  session: ScrapeRunSession<TItem, TPrepared>;
  startedAt: Date | null;
  settlement: Promise<void> | null;
  stopOperation: Promise<ScrapeRunSnapshot<TItem>> | null;
};

export class ScrapeCoordinator<TStart, TRun, TItem extends ScrapeRunItem = ScrapeRunItem, TPrepared = unknown> {
  private readonly entries = new Map<string, WorkflowEntry<TRun, TItem, TPrepared>>();
  private readonly registrations = new Set<Promise<TRun>>();
  private readonly readyRunIds: string[] = [];
  private drainPromise: Promise<void> | null = null;
  private drainRequested = false;
  private activeRunId: string | null = null;
  private closing = false;

  constructor(
    private readonly store: ScrapeRunStore<TRun>,
    private readonly host: ScrapeHostPort<TStart, TRun, TItem, TPrepared>,
  ) {}

  async start(input: TStart): Promise<ScrapeRunSnapshot<TItem>> {
    this.assertOpen();
    return await this.register(this.host.create(input));
  }

  async retry(runId: string, itemIds?: readonly string[]): Promise<ScrapeRunSnapshot<TItem>> {
    this.assertOpen();
    if (this.entries.has(runId)) throw new Error(`Scrape run is already live: ${runId}`);
    if (!this.host.retry) throw new Error("Scrape host does not support retry");
    return await this.register(this.host.retry(runId, itemIds));
  }

  async rerunDirectory(runId: string): Promise<ScrapeRunSnapshot<TItem>> {
    this.assertOpen();
    if (this.entries.has(runId)) throw new Error(`Scrape run is already live: ${runId}`);
    return await this.register(this.store.rerunDirectory(runId));
  }

  liveRuns(): Array<{ run: TRun; snapshot: ScrapeRunSnapshot<TItem>; startedAt: Date | null }> {
    return this.orderedEntries().map((entry) => ({
      run: entry.run,
      snapshot: entry.session.snapshot(),
      startedAt: entry.startedAt,
    }));
  }

  recordLog(
    runId: string,
    log: Omit<ScrapeRunLogEntry, "timestamp" | "itemId" | "relativePath"> & {
      timestamp?: Date;
      itemId?: string | null;
    },
  ): void {
    const entry = this.requireLive(runId);
    entry.session.recordLog(log);
  }

  updateLibraryFiles(updates: ReadonlyMap<string, Partial<import("@mdcz/shared/types").ScrapeResult>>): void {
    for (const entry of this.entries.values()) entry.session.updateLibraryFiles(updates);
  }

  async pause(runId: string): Promise<ScrapeRunSnapshot<TItem>> {
    const entry = this.requireLive(runId);
    this.removeReady(runId);
    return await entry.session.pause();
  }

  async resume(runId: string): Promise<ScrapeRunSnapshot<TItem>> {
    const entry = this.requireLive(runId);
    this.assertOpen();
    await entry.session.resume();
    const snapshot = entry.session.snapshot();
    if (snapshot.status === "queued") {
      this.removeReady(runId);
      this.readyRunIds.push(runId);
      this.requestDrain();
    }
    return snapshot;
  }

  stop(runId: string): Promise<ScrapeRunSnapshot<TItem>> {
    const entry = this.requireLive(runId);
    entry.stopOperation ??= this.stopEntry(entry);
    return entry.stopOperation;
  }

  private async stopEntry(entry: WorkflowEntry<TRun, TItem, TPrepared>): Promise<ScrapeRunSnapshot<TItem>> {
    this.removeReady(entry.id);
    const snapshot = await entry.session.stop();
    await this.settle(entry, snapshot);
    return snapshot;
  }

  async waitForIdle(): Promise<void> {
    await this.waitForDrain();
    await Promise.all([...this.entries.values()].map((entry) => entry.session.waitForIdle()));
  }

  async abortForShutdown(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.drainRequested = false;
    this.readyRunIds.length = 0;
    await Promise.all([...this.entries.values()].map((entry) => entry.session.abortForShutdown()));
    await this.waitForDrain();
    await Promise.all([...this.entries.values()].map((entry) => entry.stopOperation));
    await Promise.allSettled([...this.registrations]);
    for (const entry of this.entries.values()) await this.settle(entry, entry.session.snapshot());
    await this.store.interruptUnfinished();
    this.entries.clear();
    this.activeRunId = null;
    this.host.onInvalidate(this.liveRuns());
  }

  private async register(creation: Promise<TRun>): Promise<ScrapeRunSnapshot<TItem>> {
    this.registrations.add(creation);
    try {
      const run = await creation;
      this.assertOpen();
      return this.enqueue(run);
    } finally {
      this.registrations.delete(creation);
    }
  }

  private enqueue(run: TRun): ScrapeRunSnapshot<TItem> {
    const id = this.host.runId(run);
    if (!id.trim()) throw new Error("Scrape run ID must not be empty");
    if (this.entries.has(id)) throw new Error(`Scrape run is already live: ${id}`);
    const description = this.host.describe(run);
    const entry: WorkflowEntry<TRun, TItem, TPrepared> = {
      id,
      run,
      session: new ScrapeRunSession<TItem, TPrepared>({
        runId: id,
        ...description,
        onSnapshot: () => this.host.onInvalidate(this.liveRuns()),
        ...(description.totalItems === null
          ? {
              discover: async (signal: AbortSignal, report: (progress: DiscoveryProgress) => void) => {
                if (!this.host.discover) throw new Error("Directory discovery is unavailable");
                entry.run = await this.host.discover(entry.run, signal, report);
              },
            }
          : {}),
        prepare: async (signal) => {
          signal.throwIfAborted();
          if (this.host.describe(entry.run).totalItems === 0) return null;
          return await this.host.createExecution(
            entry.run,
            {
              progress: (itemId, percent) => entry.session.recordProgress(itemId, percent),
              stage: (stage) => entry.session.recordStage(stage),
            },
            signal,
          );
        },
      }),
      startedAt: null,
      settlement: null,
      stopOperation: null,
    };
    this.entries.set(id, entry);
    this.readyRunIds.push(id);
    this.host.onInvalidate(this.liveRuns());
    // Return acceptance before starting any filesystem work, including execution setup.
    queueMicrotask(() => this.requestDrain());
    return entry.session.snapshot();
  }

  private claimNext(): WorkflowEntry<TRun, TItem, TPrepared> | null {
    while (!this.closing) {
      const runId = this.readyRunIds.shift();
      if (!runId) return null;
      const entry = this.entries.get(runId);
      if (!entry || entry.session.snapshot().status !== "queued") continue;
      entry.startedAt ??= new Date();
      this.activeRunId = runId;
      return entry;
    }
    return null;
  }

  private async executeEntry(entry: WorkflowEntry<TRun, TItem, TPrepared>): Promise<void> {
    try {
      const status = entry.session.snapshot().status;
      if (status === "queued") await entry.session.start();
      await entry.session.waitForIdle();
      if (this.closing) return;
      const snapshot = entry.session.snapshot();
      if (["completed", "failed", "stopped", "interrupted"].includes(snapshot.status))
        await this.settle(entry, snapshot);
    } finally {
      if (this.activeRunId === entry.id) this.activeRunId = null;
    }
  }

  private async settle(
    entry: WorkflowEntry<TRun, TItem, TPrepared>,
    snapshot: ScrapeRunSnapshot<TItem>,
  ): Promise<void> {
    if (!["completed", "failed", "stopped", "interrupted"].includes(snapshot.status))
      throw new Error(`Cannot settle non-terminal scrape run: ${snapshot.status}`);
    entry.settlement ??= (async () => {
      const disposition = snapshot.status as ScrapeWorkflowDisposition;
      const finalized = await this.store.finalize(this.settlementInput(entry, snapshot, disposition, snapshot.error));
      runtimeLoggerService
        .getLogger("Publication")
        .info(`[publication] run-finalized operation=${entry.id} status=${disposition}`);
      try {
        await this.host.onTerminal?.(finalized, snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtimeLoggerService.getLogger("Scrape").warn(`Scrape run ${entry.id} terminal callback failed: ${message}`);
      }
    })();
    await entry.settlement;
    if (this.entries.get(entry.id) !== entry) return;
    this.entries.delete(entry.id);
    this.removeReady(entry.id);
    this.host.onInvalidate(this.liveRuns());
  }

  private orderedEntries(): WorkflowEntry<TRun, TItem, TPrepared>[] {
    const orderedIds = [this.activeRunId, ...this.readyRunIds].filter((id): id is string => Boolean(id));
    const seen = new Set(orderedIds);
    return [...orderedIds, ...[...this.entries.keys()].filter((id) => !seen.has(id))]
      .map((id) => this.entries.get(id))
      .filter((entry): entry is WorkflowEntry<TRun, TItem, TPrepared> => Boolean(entry));
  }

  private requestDrain(): void {
    if (this.closing) return;
    this.drainRequested = true;
    if (!this.drainPromise) {
      this.drainPromise = this.runDrain();
      void this.drainPromise.catch(() => undefined);
    }
  }

  private async waitForDrain(): Promise<void> {
    while (this.drainPromise) await this.drainPromise;
  }

  private async runDrain(): Promise<void> {
    try {
      do {
        this.drainRequested = false;
        while (!this.closing) {
          const entry = await Promise.resolve(this.claimNext());
          if (!entry || this.closing) break;
          try {
            await this.executeEntry(entry);
          } catch (error) {
            await this.recordSettlementFailure(entry, error);
          }
        }
      } while (!this.closing && this.drainRequested);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtimeLoggerService.getLogger("Scrape").warn(`Scrape queue drain failed: ${message}`);
      this.drainRequested = false;
      await this.host.onError?.("scrape-queue", error);
    } finally {
      this.drainPromise = null;
      if (!this.closing && this.drainRequested) this.requestDrain();
    }
  }

  private async recordSettlementFailure(entry: WorkflowEntry<TRun, TItem, TPrepared>, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    runtimeLoggerService.getLogger("Scrape").warn(`Scrape run ${entry.id} settlement failed: ${message}`);
    await this.host.onError?.(entry.id, error);
    if (!this.isTerminal(entry.session.snapshot().status)) await entry.session.abortForShutdown();
    const snapshot = entry.session.snapshot();
    const disposition = this.isTerminal(snapshot.status) ? (snapshot.status as ScrapeWorkflowDisposition) : "failed";
    await this.store
      .finalize(this.settlementInput(entry, snapshot, disposition, message))
      .catch((recordError: unknown) => {
        const recordMessage = recordError instanceof Error ? recordError.message : String(recordError);
        runtimeLoggerService
          .getLogger("Scrape")
          .warn(`Scrape run ${entry.id} could not record settlement failure: ${recordMessage}`);
      });
    this.entries.delete(entry.id);
    this.removeReady(entry.id);
    this.host.onInvalidate(this.liveRuns());
  }

  private settlementInput(
    entry: WorkflowEntry<TRun, TItem, TPrepared>,
    snapshot: ScrapeRunSnapshot<TItem>,
    disposition: ScrapeWorkflowDisposition,
    error: string | null,
  ): Parameters<ScrapeRunStore<TRun>["finalize"]>[0] {
    return {
      runId: entry.id,
      ...(snapshot.discovery ? { discoveryJson: JSON.stringify(snapshot.discovery) } : {}),
      disposition,
      error,
      startedAt: entry.startedAt,
      successCount: snapshot.items.filter((item) => item.status === "success").length,
      failedCount: snapshot.items.filter((item) => item.status === "failed").length,
      skippedCount: snapshot.items.filter((item) => item.status === "skipped").length,
      totalBytes: snapshot.items.reduce(
        (bytes, item) => bytes + (item.status === "success" ? (item.result?.size ?? 0) : 0),
        0,
      ),
    };
  }

  private isTerminal(status: string): boolean {
    return status === "completed" || status === "failed" || status === "stopped" || status === "interrupted";
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("Scrape queue is closing");
  }

  private requireLive(runId: string): WorkflowEntry<TRun, TItem, TPrepared> {
    const entry = this.entries.get(runId);
    if (!entry) throw new Error(`Scrape run is not live in this backend process: ${runId}`);
    return entry;
  }

  private removeReady(runId: string): void {
    for (let index = this.readyRunIds.length - 1; index >= 0; index -= 1) {
      if (this.readyRunIds[index] === runId) this.readyRunIds.splice(index, 1);
    }
  }
}
