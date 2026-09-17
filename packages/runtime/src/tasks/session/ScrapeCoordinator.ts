import type { DiscoveryProgress } from "@mdcz/shared/directoryTasks";
import { runtimeLoggerService } from "../../shared";
import { TaskScheduler } from "../scheduler";
import {
  type ScrapeRunExecution,
  type ScrapeRunLogEntry,
  ScrapeRunSession,
  type ScrapeRunSnapshot,
  type ScrapeRunStageSnapshot,
} from "./ScrapeRunSession";

export type ScrapeWorkflowDisposition = "completed" | "failed" | "stopped" | "interrupted";

export interface ScrapeRunStore<TRun> {
  rerunDirectory(runId: string): Promise<TRun>;
  retry(runId: string, itemIds?: readonly string[]): Promise<TRun>;
  finalize(input: {
    discoveryJson?: string;
    runId: string;
    revision?: number;
    disposition: ScrapeWorkflowDisposition;
    error?: string | null;
    startedAt?: Date | null;
  }): Promise<TRun>;
  interruptUnfinished(interruptedAt?: Date): void | Promise<void>;
}

export interface ScrapeWorkflowReporter {
  progress(itemId: string, percent: number): void;
  stage(stage: Omit<ScrapeRunStageSnapshot, "itemId" | "relativePath"> & { itemId?: string | null }): void;
}

export type ScrapeHostExecution<TManualScrape, TPrepared> = ScrapeRunExecution<TManualScrape, TPrepared>;

export interface ScrapeHostPort<TStart, TRun, TManualScrape = unknown, TPrepared = unknown> {
  create(input: TStart): Promise<TRun>;
  runId(run: TRun): string;
  describe(run: TRun): { executionGeneration: number; totalItems: number | null };
  discover?(run: TRun, signal: AbortSignal, onProgress: (progress: DiscoveryProgress) => void): Promise<TRun>;
  createExecution(run: TRun, reporter: ScrapeWorkflowReporter): Promise<ScrapeHostExecution<TManualScrape, TPrepared>>;
  onInvalidate(runs: Array<{ run: TRun; snapshot: ScrapeRunSnapshot<TManualScrape>; startedAt: Date | null }>): void;
  onTerminal?(run: TRun, snapshot: ScrapeRunSnapshot<TManualScrape>): Promise<void> | void;
  onError?(runId: string, error: unknown): Promise<void> | void;
}

type WorkflowEntry<TRun, TManualScrape, TPrepared> = {
  id: string;
  run: TRun;
  session: ScrapeRunSession<TManualScrape, TPrepared>;
  startedAt: Date | null;
  settlement: Promise<void> | null;
  stopOperation: Promise<ScrapeRunSnapshot<TManualScrape>> | null;
};

export class ScrapeCoordinator<TStart, TRun, TManualScrape = unknown, TPrepared = unknown> {
  private readonly entries = new Map<string, WorkflowEntry<TRun, TManualScrape, TPrepared>>();
  private readonly registrations = new Set<Promise<TRun>>();
  private readonly readyRunIds: string[] = [];
  private readonly scheduler: TaskScheduler<WorkflowEntry<TRun, TManualScrape, TPrepared>>;
  private activeRunId: string | null = null;
  private closing = false;
  private repairRequired: string | null = null;

  constructor(
    private readonly store: ScrapeRunStore<TRun>,
    private readonly host: ScrapeHostPort<TStart, TRun, TManualScrape, TPrepared>,
  ) {
    this.scheduler = new TaskScheduler({
      claimNext: async () => this.claimNext(),
      runExecution: async (entry) => await this.executeEntry(entry),
      onExecutionError: async (entry, error) => {
        await this.host.onError?.(entry.id, error);
        await entry.session.abortForShutdown();
        this.repairRequired = error instanceof Error ? error.message : String(error);
        this.entries.delete(entry.id);
        this.host.onInvalidate(this.liveRuns());
      },
      onDrainError: async (error) => {
        this.repairRequired = error instanceof Error ? error.message : String(error);
        await this.host.onError?.("scrape-queue", error);
      },
    });
  }

  async start(input: TStart): Promise<ScrapeRunSnapshot<TManualScrape>> {
    this.assertOpen();
    return await this.register(this.host.create(input));
  }

  async retry(runId: string, itemIds?: readonly string[]): Promise<ScrapeRunSnapshot<TManualScrape>> {
    this.assertOpen();
    if (this.entries.has(runId)) throw new Error(`Scrape run is already live: ${runId}`);
    return await this.register(itemIds ? this.store.retry(runId, itemIds) : this.store.retry(runId));
  }

  async rerunDirectory(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    this.assertOpen();
    if (this.entries.has(runId)) throw new Error(`Scrape run is already live: ${runId}`);
    return await this.register(this.store.rerunDirectory(runId));
  }

  liveRuns(): Array<{ run: TRun; snapshot: ScrapeRunSnapshot<TManualScrape>; startedAt: Date | null }> {
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

  async pause(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    const entry = this.requireLive(runId);
    this.removeReady(runId);
    return await entry.session.pause();
  }

  async resume(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    const entry = this.requireLive(runId);
    this.assertOpen();
    await entry.session.resume();
    const snapshot = entry.session.snapshot();
    if (snapshot.status === "queued") {
      this.removeReady(runId);
      this.readyRunIds.push(runId);
      this.scheduler.drain();
    }
    return snapshot;
  }

  stop(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    const entry = this.requireLive(runId);
    entry.stopOperation ??= this.stopEntry(entry);
    return entry.stopOperation;
  }

  private async stopEntry(
    entry: WorkflowEntry<TRun, TManualScrape, TPrepared>,
  ): Promise<ScrapeRunSnapshot<TManualScrape>> {
    this.removeReady(entry.id);
    const snapshot = await entry.session.stop();
    await this.settle(entry, snapshot);
    return snapshot;
  }

  async waitForIdle(): Promise<void> {
    await this.scheduler.waitForIdle();
    await Promise.all([...this.entries.values()].map((entry) => entry.session.waitForIdle()));
  }

  async abortForShutdown(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.scheduler.requestStop();
    this.readyRunIds.length = 0;
    await Promise.all([...this.entries.values()].map((entry) => entry.session.abortForShutdown()));
    await this.scheduler.waitForIdle();
    await Promise.all([...this.entries.values()].map((entry) => entry.stopOperation));
    await Promise.allSettled([...this.registrations]);
    await this.store.interruptUnfinished();
    this.entries.clear();
    this.activeRunId = null;
    this.host.onInvalidate(this.liveRuns());
  }

  private async register(creation: Promise<TRun>): Promise<ScrapeRunSnapshot<TManualScrape>> {
    this.registrations.add(creation);
    try {
      const run = await creation;
      this.assertOpen();
      return this.enqueue(run);
    } finally {
      this.registrations.delete(creation);
    }
  }

  private enqueue(run: TRun): ScrapeRunSnapshot<TManualScrape> {
    const id = this.host.runId(run);
    if (!id.trim()) throw new Error("Scrape run ID must not be empty");
    if (this.entries.has(id)) throw new Error(`Scrape run is already live: ${id}`);
    const description = this.host.describe(run);
    const entry: WorkflowEntry<TRun, TManualScrape, TPrepared> = {
      id,
      run,
      session: new ScrapeRunSession<TManualScrape, TPrepared>({
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
          return await this.host.createExecution(entry.run, {
            progress: (itemId, percent) => entry.session.recordProgress(itemId, percent),
            stage: (stage) => entry.session.recordStage(stage),
          });
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
    queueMicrotask(() => this.scheduler.drain());
    return entry.session.snapshot();
  }

  private claimNext(): WorkflowEntry<TRun, TManualScrape, TPrepared> | null {
    while (!this.closing && !this.repairRequired) {
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

  private async executeEntry(entry: WorkflowEntry<TRun, TManualScrape, TPrepared>): Promise<void> {
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
    entry: WorkflowEntry<TRun, TManualScrape, TPrepared>,
    snapshot: ScrapeRunSnapshot<TManualScrape>,
  ): Promise<void> {
    if (!["completed", "failed", "stopped", "interrupted"].includes(snapshot.status))
      throw new Error(`Cannot settle non-terminal scrape run: ${snapshot.status}`);
    entry.settlement ??= (async () => {
      const disposition = snapshot.status as ScrapeWorkflowDisposition;
      const finalized = await this.store.finalize({
        runId: entry.id,
        ...(snapshot.discovery ? { discoveryJson: JSON.stringify(snapshot.discovery) } : {}),
        revision: snapshot.revision,
        disposition,
        error: snapshot.error,
        startedAt: entry.startedAt,
      });
      runtimeLoggerService
        .getLogger("Publication")
        .info(`[publication] run-finalized operation=${entry.id} status=${disposition}`);
      await this.host.onTerminal?.(finalized, snapshot);
    })();
    await entry.settlement;
    if (this.entries.get(entry.id) !== entry) return;
    this.entries.delete(entry.id);
    this.removeReady(entry.id);
    if (snapshot.status === "interrupted")
      this.repairRequired = snapshot.error ?? `Scrape run was interrupted: ${entry.id}`;
    this.host.onInvalidate(this.liveRuns());
  }

  private orderedEntries(): WorkflowEntry<TRun, TManualScrape, TPrepared>[] {
    const orderedIds = [this.activeRunId, ...this.readyRunIds].filter((id): id is string => Boolean(id));
    const seen = new Set(orderedIds);
    return [...orderedIds, ...[...this.entries.keys()].filter((id) => !seen.has(id))]
      .map((id) => this.entries.get(id))
      .filter((entry): entry is WorkflowEntry<TRun, TManualScrape, TPrepared> => Boolean(entry));
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("Scrape queue is closing");
    if (this.repairRequired) throw new Error(`Scrape queue requires repair: ${this.repairRequired}`);
  }

  private requireLive(runId: string): WorkflowEntry<TRun, TManualScrape, TPrepared> {
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
