import type { ScrapeResult } from "@mdcz/shared/types";
import { TaskScheduler } from "../scheduler";
import {
  type ScrapeRunItem,
  type ScrapeRunLogEntry,
  ScrapeRunSession,
  type ScrapeRunSnapshot,
  type ScrapeRunStageSnapshot,
} from "./ScrapeRunSession";

export type ScrapeWorkflowDisposition = "completed" | "failed" | "stopped" | "interrupted";

export interface ScrapeRunStore<TStart, TRun> {
  create(input: TStart): Promise<TRun>;
  get(runId: string): Promise<TRun>;
  list(): Promise<TRun[]>;
  retry(runId: string): Promise<TRun>;
  finalize(input: {
    runId: string;
    disposition: ScrapeWorkflowDisposition;
    error?: string | null;
    startedAt?: Date | null;
  }): Promise<TRun>;
  interruptUnfinished?(interruptedAt?: Date): void | Promise<void>;
  summary(run: TRun): unknown | null | Promise<unknown | null>;
  latestOutcomes(run: TRun): readonly unknown[] | Promise<readonly unknown[]>;
}

export interface ScrapeWorkflowReporter {
  progress(itemId: string, percent: number): void;
  stage(stage: Omit<ScrapeRunStageSnapshot, "itemId" | "relativePath"> & { itemId?: string | null }): void;
  log(
    entry: Omit<ScrapeRunLogEntry, "timestamp" | "itemId" | "relativePath"> & {
      timestamp?: Date;
      itemId?: string | null;
    },
  ): void;
}

export interface ScrapeHostExecution<TManualScrape> {
  items: readonly ScrapeRunItem<TManualScrape>[];
  concurrency: number;
  admitItem(item: ScrapeRunItem<TManualScrape>): Promise<string>;
  executeItem(item: ScrapeRunItem<TManualScrape>, signal: AbortSignal, attemptId: string): Promise<ScrapeResult>;
  commitItem(item: ScrapeRunItem<TManualScrape>, result: ScrapeResult, attemptId: string): Promise<ScrapeResult>;
  acquireItem?(item: ScrapeRunItem<TManualScrape>): () => void;
}

export interface ScrapeHostPort<TRun, TManualScrape> {
  runId(run: TRun): string;
  createdAt(run: TRun): Date;
  createExecution(run: TRun, reporter: ScrapeWorkflowReporter): Promise<ScrapeHostExecution<TManualScrape>>;
  onInvalidate(): void;
  onTerminal?(run: TRun, snapshot: ScrapeRunSnapshot<TManualScrape>): Promise<void> | void;
  onError?(runId: string, error: unknown): Promise<void> | void;
}

type WorkflowEntry<TRun, TManualScrape> = {
  id: string;
  run: TRun;
  session: ScrapeRunSession<TManualScrape>;
  state: "queued" | "running" | "paused" | "stopping";
  startedAt: Date | null;
  settlement: Promise<void> | null;
};

export class ScrapeCoordinator<TStart, TRun, TManualScrape = unknown> {
  private readonly entries = new Map<string, WorkflowEntry<TRun, TManualScrape>>();
  private readonly readyRunIds: string[] = [];
  private readonly scheduler: TaskScheduler<WorkflowEntry<TRun, TManualScrape>>;
  private activeRunId: string | null = null;
  private closing = false;
  private repairRequired: string | null = null;
  private lastTerminalSnapshot: ScrapeRunSnapshot<TManualScrape> | null = null;

  constructor(
    private readonly store: ScrapeRunStore<TStart, TRun>,
    private readonly host: ScrapeHostPort<TRun, TManualScrape>,
  ) {
    this.scheduler = new TaskScheduler({
      claimNext: async () => this.claimNext(),
      runExecution: async (entry) => await this.runEntry(entry),
      onExecutionError: async (entry, error) => {
        await this.host.onError?.(entry.id, error);
        await entry.session.abortForShutdown();
        this.repairRequired = error instanceof Error ? error.message : String(error);
        this.entries.delete(entry.id);
        this.host.onInvalidate();
      },
    });
  }

  async start(input: TStart): Promise<ScrapeRunSnapshot<TManualScrape>> {
    if (this.closing) throw new Error("Scrape queue is closing");
    if (this.repairRequired) throw new Error(`Scrape queue requires repair: ${this.repairRequired}`);
    return await this.enqueue(await this.store.create(input));
  }

  async retry(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    if (this.closing) throw new Error("Scrape queue is closing");
    if (this.repairRequired) throw new Error(`Scrape queue requires repair: ${this.repairRequired}`);
    if (this.entries.has(runId)) throw new Error(`Scrape run is already live: ${runId}`);
    return await this.enqueue(await this.store.retry(runId));
  }

  snapshot(runId: string): ScrapeRunSnapshot<TManualScrape> | null {
    const entry = this.entries.get(runId);
    return entry
      ? this.entrySnapshot(entry)
      : this.lastTerminalSnapshot?.runId === runId
        ? this.lastTerminalSnapshot
        : null;
  }

  snapshots(): ScrapeRunSnapshot<TManualScrape>[] {
    return this.orderedEntries().map((entry) => this.entrySnapshot(entry));
  }

  latestSnapshot(): ScrapeRunSnapshot<TManualScrape> | null {
    const live = this.orderedEntries()[0];
    return live ? this.entrySnapshot(live) : this.lastTerminalSnapshot;
  }
  liveRuns(): Array<{
    run: TRun;
    snapshot: ScrapeRunSnapshot<TManualScrape>;
    startedAt: Date | null;
  }> {
    return this.orderedEntries().map((entry) => ({
      run: entry.run,
      snapshot: this.entrySnapshot(entry),
      startedAt: entry.startedAt,
    }));
  }

  recordProgress(runId: string, itemId: string, percent: number): void {
    this.requireLive(runId).session.recordProgress(itemId, percent);
  }

  recordStage(
    runId: string,
    stage: Omit<ScrapeRunStageSnapshot, "itemId" | "relativePath"> & { itemId?: string | null },
  ): void {
    this.requireLive(runId).session.recordStage(stage);
  }

  recordLog(
    runId: string,
    entry: Omit<ScrapeRunLogEntry, "timestamp" | "itemId" | "relativePath"> & {
      timestamp?: Date;
      itemId?: string | null;
    },
  ): void {
    this.requireLive(runId).session.recordLog(entry);
  }

  async history(): Promise<TRun[]> {
    return await this.store.list();
  }

  async pause(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    const entry = this.requireLive(runId);
    if (entry.state === "paused") return this.entrySnapshot(entry);
    if (entry.state !== "queued" && entry.state !== "running") {
      throw new Error(`Cannot pause scrape run in ${entry.state} state: ${runId}`);
    }
    this.removeReady(runId);
    entry.state = "paused";
    const snapshot = await entry.session.pause();
    this.host.onInvalidate();
    return { ...snapshot, status: "paused" };
  }

  async resume(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    const entry = this.requireLive(runId);
    if (entry.state !== "paused") throw new Error(`Cannot resume scrape run in ${entry.state} state: ${runId}`);
    if (this.closing) throw new Error("Scrape queue is closing");
    if (this.repairRequired) throw new Error(`Scrape queue requires repair: ${this.repairRequired}`);
    entry.state = "queued";
    this.readyRunIds.push(runId);
    this.host.onInvalidate();
    this.scheduler.drain();
    return this.entrySnapshot(entry);
  }

  async stop(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    const entry = this.requireLive(runId);
    entry.state = "stopping";
    this.removeReady(runId);
    this.host.onInvalidate();
    const snapshot = await entry.session.stop();
    await this.settle(entry, snapshot);
    return snapshot;
  }

  async waitForIdle(): Promise<void> {
    await this.scheduler.waitForIdle();
    await Promise.all([...this.entries.values()].map(async (entry) => await entry.session.waitForIdle()));
  }

  async abortForShutdown(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.scheduler.requestStop();
    this.readyRunIds.length = 0;
    await Promise.all([...this.entries.values()].map(async (entry) => await entry.session.abortForShutdown()));
    await this.scheduler.waitForIdle();
    await this.store.interruptUnfinished?.();
    this.entries.clear();
    this.activeRunId = null;
    this.host.onInvalidate();
  }

  private async enqueue(run: TRun): Promise<ScrapeRunSnapshot<TManualScrape>> {
    if (this.closing) throw new Error("Scrape queue is closing");
    const id = this.host.runId(run);
    if (!id.trim()) throw new Error("Scrape run ID must not be empty");
    if (this.entries.has(id)) throw new Error(`Scrape run is already live: ${id}`);
    const entry = {} as WorkflowEntry<TRun, TManualScrape>;
    const reporter: ScrapeWorkflowReporter = {
      progress: (itemId, percent) => entry.session.recordProgress(itemId, percent),
      stage: (stage) => entry.session.recordStage(stage),
      log: (log) => entry.session.recordLog(log),
    };
    const execution = await this.host.createExecution(run, reporter);
    const session = new ScrapeRunSession<TManualScrape>({
      runId: id,
      items: execution.items,
      concurrency: execution.concurrency,
      acquireItem: execution.acquireItem,
      admitItem: execution.admitItem,
      executeItem: execution.executeItem,
      commitItem: execution.commitItem,
      onSnapshot: () => this.host.onInvalidate(),
    });
    Object.assign(entry, {
      id,
      run,
      session,
      state: "queued",
      startedAt: null,
      settlement: null,
    } satisfies WorkflowEntry<TRun, TManualScrape>);
    this.entries.set(id, entry);
    this.readyRunIds.push(id);
    this.lastTerminalSnapshot = null;
    this.host.onInvalidate();
    this.scheduler.drain();
    return this.entrySnapshot(entry);
  }

  private claimNext(): WorkflowEntry<TRun, TManualScrape> | null {
    while (!this.closing && !this.repairRequired) {
      const runId = this.readyRunIds.shift();
      if (!runId) return null;
      const entry = this.entries.get(runId);
      if (!entry || entry.state !== "queued") continue;
      entry.state = "running";
      entry.startedAt ??= new Date();
      this.activeRunId = runId;
      this.host.onInvalidate();
      return entry;
    }
    return null;
  }

  private async runEntry(entry: WorkflowEntry<TRun, TManualScrape>): Promise<void> {
    try {
      const status = entry.session.snapshot().status;
      if (status === "queued") await entry.session.start();
      else if (status === "paused") await entry.session.resume();
      else throw new Error(`Cannot schedule scrape session in ${status} state: ${entry.id}`);
      await entry.session.waitForIdle();
      if (this.closing) return;
      const snapshot = entry.session.snapshot();
      if (
        snapshot.status === "completed" ||
        snapshot.status === "failed" ||
        snapshot.status === "stopped" ||
        snapshot.status === "interrupted"
      ) {
        await this.settle(entry, snapshot);
      }
    } finally {
      if (this.activeRunId === entry.id) this.activeRunId = null;
    }
  }

  private async settle(
    entry: WorkflowEntry<TRun, TManualScrape>,
    snapshot: ScrapeRunSnapshot<TManualScrape>,
  ): Promise<void> {
    entry.settlement ??= (async () => {
      const disposition =
        snapshot.status === "completed"
          ? "completed"
          : snapshot.status === "stopped"
            ? "stopped"
            : snapshot.status === "interrupted"
              ? "interrupted"
              : "failed";
      const finalized = await this.store.finalize({
        runId: entry.id,
        disposition,
        error: snapshot.error,
        startedAt: entry.startedAt,
      });
      await this.host.onTerminal?.(finalized, snapshot);
    })();
    await entry.settlement;
    if (this.entries.get(entry.id) !== entry) return;
    this.lastTerminalSnapshot = snapshot;
    this.entries.delete(entry.id);
    this.removeReady(entry.id);
    if (snapshot.status === "interrupted") {
      this.repairRequired = snapshot.error ?? `Scrape run was interrupted: ${entry.id}`;
    }
    this.host.onInvalidate();
  }

  private entrySnapshot(entry: WorkflowEntry<TRun, TManualScrape>): ScrapeRunSnapshot<TManualScrape> {
    const snapshot = entry.session.snapshot();
    if (entry.state === "paused" && snapshot.status === "queued") return { ...snapshot, status: "paused" };
    if (
      entry.state === "stopping" &&
      snapshot.status !== "completed" &&
      snapshot.status !== "failed" &&
      snapshot.status !== "stopped" &&
      snapshot.status !== "interrupted"
    ) {
      return { ...snapshot, status: "stopping" };
    }
    return snapshot;
  }

  private orderedEntries(): WorkflowEntry<TRun, TManualScrape>[] {
    const orderedIds = [this.activeRunId, ...this.readyRunIds].filter((id): id is string => Boolean(id));
    const seen = new Set(orderedIds);
    return [...orderedIds, ...[...this.entries.keys()].filter((id) => !seen.has(id))]
      .map((id) => this.entries.get(id))
      .filter((entry): entry is WorkflowEntry<TRun, TManualScrape> => Boolean(entry));
  }

  private requireLive(runId: string): WorkflowEntry<TRun, TManualScrape> {
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
