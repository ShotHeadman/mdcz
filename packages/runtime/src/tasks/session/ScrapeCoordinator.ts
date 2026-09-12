import type { DiscoveryProgress } from "@mdcz/shared/directoryTasks";
import { runtimeLoggerService } from "../../shared";
import { TaskScheduler } from "../scheduler";
import {
  type ScrapeRunLogEntry,
  ScrapeRunSession,
  type ScrapeRunSessionOptions,
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

export type ScrapeHostExecution<TManualScrape, TPrepared> = Omit<
  ScrapeRunSessionOptions<TManualScrape, TPrepared>,
  "runId" | "onSnapshot"
>;

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
  phase:
    | { kind: "pending"; controller: AbortController; snapshot: ScrapeRunSnapshot<TManualScrape> }
    | { kind: "session"; session: ScrapeRunSession<TManualScrape, TPrepared> };
  state: "queued" | "running" | "paused" | "stopping";
  startedAt: Date | null;
  settlement: Promise<void> | null;
  completion: Promise<void> | null;
  stopOperation: Promise<ScrapeRunSnapshot<TManualScrape>> | null;
  revisionOffset: number;
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
      runExecution: async (entry) => await this.runEntry(entry),
      onExecutionError: async (entry, error) => {
        await this.host.onError?.(entry.id, error);
        if (entry.phase.kind === "session") await entry.phase.session.abortForShutdown();
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
      snapshot: this.entrySnapshot(entry),
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
    if (entry.phase.kind === "session") entry.phase.session.recordLog(log);
    else {
      entry.phase.snapshot.logs.push({
        ...log,
        timestamp: log.timestamp ?? new Date(),
        itemId: log.itemId ?? null,
        relativePath: null,
      });
      entry.phase.snapshot.logs = entry.phase.snapshot.logs.slice(-200);
    }
  }

  async pause(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    const entry = this.requireLive(runId);
    if (entry.state === "paused") return this.entrySnapshot(entry);
    if (entry.phase.kind === "pending" && this.host.describe(entry.run).totalItems === null)
      throw new Error("文件发现阶段不支持暂停，请停止任务");
    if (entry.state !== "queued" && entry.state !== "running")
      throw new Error(`Cannot pause scrape run in ${entry.state} state: ${runId}`);
    this.removeReady(runId);
    entry.state = "paused";
    if (entry.phase.kind === "session") await entry.phase.session.pause();
    this.host.onInvalidate(this.liveRuns());
    return this.entrySnapshot(entry);
  }

  async resume(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    const entry = this.requireLive(runId);
    if (entry.state === "queued" || entry.state === "running") return this.entrySnapshot(entry);
    if (entry.state !== "paused") throw new Error(`Cannot resume scrape run: ${runId}`);
    this.assertOpen();
    if (
      entry.phase.kind === "session" &&
      this.activeRunId === runId &&
      entry.phase.session.snapshot().status === "paused"
    ) {
      entry.state = "running";
      await entry.phase.session.resume();
    } else {
      entry.state = "queued";
      this.readyRunIds.push(runId);
      this.scheduler.drain();
    }
    this.host.onInvalidate(this.liveRuns());
    return this.entrySnapshot(entry);
  }

  stop(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    const entry = this.requireLive(runId);
    entry.stopOperation ??= this.stopEntry(entry);
    return entry.stopOperation;
  }

  private async stopEntry(
    entry: WorkflowEntry<TRun, TManualScrape, TPrepared>,
  ): Promise<ScrapeRunSnapshot<TManualScrape>> {
    entry.state = "stopping";
    this.removeReady(entry.id);
    if (entry.phase.kind === "pending") entry.phase.controller.abort();
    this.host.onInvalidate(this.liveRuns());
    if (entry.phase.kind === "session") {
      await entry.phase.session.stop();
      const snapshot = this.entrySnapshot(entry);
      await this.settle(entry, snapshot);
      return snapshot;
    }
    await entry.completion;
    const snapshot = { ...this.entrySnapshot(entry), status: "stopped" as const };
    await this.settle(entry, snapshot);
    return snapshot;
  }

  async waitForIdle(): Promise<void> {
    await this.scheduler.waitForIdle();
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        if (entry.phase.kind === "session") await entry.phase.session.waitForIdle();
      }),
    );
  }

  async abortForShutdown(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.scheduler.requestStop();
    this.readyRunIds.length = 0;
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        if (entry.phase.kind === "session") await entry.phase.session.abortForShutdown();
        else entry.phase.controller.abort();
      }),
    );
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
      phase: {
        kind: "pending",
        controller: new AbortController(),
        snapshot: {
          runId: id,
          executionGeneration: description.executionGeneration,
          generation: 0,
          revision: 0,
          status: "queued",
          progress: {
            totalItems: description.totalItems,
            completedItems: 0,
            percent: description.totalItems === null ? null : 0,
          },
          items: [],
          latestStage: null,
          logs: [],
          error: null,
        },
      },
      state: "queued",
      startedAt: null,
      settlement: null,
      completion: null,
      stopOperation: null,
      revisionOffset: 0,
    };
    this.entries.set(id, entry);
    this.readyRunIds.push(id);
    this.host.onInvalidate(this.liveRuns());
    // Return acceptance before starting any filesystem work, including execution setup.
    queueMicrotask(() => this.scheduler.drain());
    return this.entrySnapshot(entry);
  }

  private claimNext(): WorkflowEntry<TRun, TManualScrape, TPrepared> | null {
    while (!this.closing && !this.repairRequired) {
      const runId = this.readyRunIds.shift();
      if (!runId) return null;
      const entry = this.entries.get(runId);
      if (!entry || entry.state !== "queued") continue;
      entry.state = "running";
      entry.startedAt ??= new Date();
      this.activeRunId = runId;
      this.host.onInvalidate(this.liveRuns());
      return entry;
    }
    return null;
  }

  private runEntry(entry: WorkflowEntry<TRun, TManualScrape, TPrepared>): Promise<void> {
    entry.completion = this.executeEntry(entry);
    return entry.completion;
  }

  private async executeEntry(entry: WorkflowEntry<TRun, TManualScrape, TPrepared>): Promise<void> {
    try {
      if (entry.phase.kind === "pending") {
        const pending = entry.phase;
        if (this.host.describe(entry.run).totalItems === null) {
          if (!this.host.discover) throw new Error("Directory discovery is unavailable");
          pending.snapshot.status = "discovering";
          pending.snapshot.latestStage = {
            stage: "discovering",
            message: "正在发现视频文件",
            itemId: null,
            relativePath: null,
          };
          this.host.onInvalidate(this.liveRuns());
          entry.run = await this.host.discover(entry.run, pending.controller.signal, (progress) => {
            pending.snapshot.discovery = progress;
            pending.snapshot.revision += 1;
            this.host.onInvalidate(this.liveRuns());
          });
          pending.controller.signal.throwIfAborted();
        }
        if (this.closing || entry.state === "stopping") return;
        if (this.host.describe(entry.run).totalItems === 0) {
          pending.snapshot = {
            ...pending.snapshot,
            status: "completed",
            progress: { percent: 100, completedItems: 0, totalItems: 0 },
            latestStage: { stage: "completed", message: "未发现可处理视频", itemId: null, relativePath: null },
          };
          await this.settle(entry, pending.snapshot);
          return;
        }
        const reporter: ScrapeWorkflowReporter = {
          progress: (itemId, percent) => {
            if (entry.phase.kind === "session") entry.phase.session.recordProgress(itemId, percent);
          },
          stage: (stage) => {
            if (entry.phase.kind === "session") entry.phase.session.recordStage(stage);
          },
        };
        const execution = await this.host.createExecution(entry.run, reporter);
        const session = new ScrapeRunSession<TManualScrape, TPrepared>({
          ...execution,
          runId: entry.id,
          onSnapshot: () => this.host.onInvalidate(this.liveRuns()),
        });
        for (const log of pending.snapshot.logs) session.recordLog(log);
        entry.revisionOffset = pending.snapshot.revision + 1;
        entry.phase = { kind: "session", session };
        if (this.closing) {
          await session.abortForShutdown();
          return;
        }
        if (pending.controller.signal.aborted) {
          await session.stop();
          return;
        }
        if (entry.state === "paused") return;
      }
      const session = entry.phase.session;
      const status = session.snapshot().status;
      if (status === "queued") await session.start();
      else if (status === "paused") await session.resume();
      else throw new Error(`Cannot schedule scrape session in ${status} state: ${entry.id}`);
      await session.waitForIdle();
      if (this.closing || entry.state === "stopping") return;
      const snapshot = this.entrySnapshot(entry);
      if (["completed", "failed", "stopped", "interrupted"].includes(snapshot.status))
        await this.settle(entry, snapshot);
    } catch (error) {
      if (this.closing || entry.state === "stopping") return;
      if (entry.phase.kind === "session" || entry.settlement) throw error;
      entry.phase.snapshot = {
        ...entry.phase.snapshot,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      await this.settle(entry, entry.phase.snapshot);
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

  private entrySnapshot(entry: WorkflowEntry<TRun, TManualScrape, TPrepared>): ScrapeRunSnapshot<TManualScrape> {
    let snapshot = entry.phase.kind === "session" ? entry.phase.session.snapshot() : entry.phase.snapshot;
    if (entry.phase.kind === "session") snapshot = { ...snapshot, revision: snapshot.revision + entry.revisionOffset };
    if (entry.state === "paused") return { ...snapshot, status: "paused" };
    if (entry.state === "queued") return { ...snapshot, status: "queued" };
    if (entry.state === "stopping" && !["completed", "failed", "stopped", "interrupted"].includes(snapshot.status))
      return { ...snapshot, status: "stopping" };
    return snapshot;
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
