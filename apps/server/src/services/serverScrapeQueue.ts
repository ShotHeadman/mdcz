import { type ScrapeRunSession, type ScrapeRunSnapshot, TaskScheduler } from "@mdcz/runtime/tasks";

export type ServerScrapeQueueStatus = "queued" | "running" | "paused" | "stopping";

export interface ServerScrapeQueueEntry<TManualScrape = unknown> {
  runId: string;
  session: ScrapeRunSession<TManualScrape>;
  status: ServerScrapeQueueStatus;
  createdAt: Date;
  startedAt: Date | null;
}

export interface SubmitServerScrapeRun<TManualScrape = unknown> {
  runId: string;
  session: ScrapeRunSession<TManualScrape>;
  createdAt: Date;
  settle: (snapshot: ScrapeRunSnapshot<TManualScrape>, startedAt: Date | null) => Promise<void>;
}

interface MutableServerScrapeQueueEntry<TManualScrape> extends ServerScrapeQueueEntry<TManualScrape> {
  id: string;
  settle: SubmitServerScrapeRun<TManualScrape>["settle"];
  settlement: Promise<void> | null;
}

export class ServerScrapeQueue<TManualScrape = unknown> {
  private readonly entries = new Map<string, MutableServerScrapeQueueEntry<TManualScrape>>();
  private readonly readyRunIds: string[] = [];
  private readonly scheduler: TaskScheduler<MutableServerScrapeQueueEntry<TManualScrape>>;
  private activeRunId: string | null = null;
  private closing = false;

  constructor(private readonly onQueueChange: (runId: string | null) => void = () => undefined) {
    this.scheduler = new TaskScheduler({
      claimNext: async () => await this.claimNext(),
      runExecution: async (entry) => await this.runExecution(entry),
    });
  }

  submit(input: SubmitServerScrapeRun<TManualScrape>): ServerScrapeQueueEntry<TManualScrape> {
    if (this.closing) throw new Error("Scrape queue is closing");
    if (this.entries.has(input.runId)) throw new Error(`Scrape run is already live: ${input.runId}`);
    if (input.session.snapshot().runId !== input.runId) {
      throw new Error(`Scrape session run ID does not match queue entry: ${input.runId}`);
    }
    const entry: MutableServerScrapeQueueEntry<TManualScrape> = {
      id: input.runId,
      runId: input.runId,
      session: input.session,
      status: "queued",
      createdAt: new Date(input.createdAt),
      startedAt: null,
      settle: input.settle,
      settlement: null,
    };
    this.entries.set(entry.runId, entry);
    this.readyRunIds.push(entry.runId);
    this.onQueueChange(entry.runId);
    this.scheduler.drain();
    return this.copyEntry(entry);
  }

  get(runId: string): ServerScrapeQueueEntry<TManualScrape> | null {
    const entry = this.entries.get(runId);
    return entry ? this.copyEntry(entry) : null;
  }

  list(): ServerScrapeQueueEntry<TManualScrape>[] {
    return [...this.entries.values()]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((entry) => this.copyEntry(entry));
  }

  async claimNext(): Promise<MutableServerScrapeQueueEntry<TManualScrape> | null> {
    while (this.readyRunIds.length > 0 && !this.closing) {
      const runId = this.readyRunIds.shift();
      if (!runId) continue;
      const entry = this.entries.get(runId);
      if (!entry || entry.status !== "queued") continue;
      entry.status = "running";
      entry.startedAt ??= new Date();
      this.activeRunId = entry.runId;
      this.onQueueChange(entry.runId);
      return entry;
    }
    return null;
  }

  async pause(runId: string): Promise<ServerScrapeQueueEntry<TManualScrape>> {
    const entry = this.requireEntry(runId);
    if (entry.status === "paused") return this.copyEntry(entry);
    if (entry.status !== "queued" && entry.status !== "running") {
      throw new Error(`Cannot pause scrape run in ${entry.status} state: ${runId}`);
    }
    entry.status = "paused";
    this.removeReadyRun(runId);
    this.onQueueChange(runId);
    if (this.activeRunId === runId) await entry.session.pause();
    return this.copyEntry(entry);
  }

  resume(runId: string): ServerScrapeQueueEntry<TManualScrape> {
    const entry = this.requireEntry(runId);
    if (entry.status !== "paused") throw new Error(`Cannot resume scrape run in ${entry.status} state: ${runId}`);
    if (this.closing) throw new Error("Scrape queue is closing");
    entry.status = "queued";
    this.readyRunIds.push(runId);
    this.onQueueChange(runId);
    this.scheduler.drain();
    return this.copyEntry(entry);
  }

  async stop(runId: string): Promise<ScrapeRunSnapshot<TManualScrape>> {
    const entry = this.requireEntry(runId);
    entry.status = "stopping";
    this.removeReadyRun(runId);
    this.onQueueChange(runId);
    const snapshot = await entry.session.stop();
    await this.settleAndRemove(entry, snapshot);
    return snapshot;
  }

  async beginClose(): Promise<void> {
    if (this.closing) {
      await this.scheduler.waitForIdle();
      return;
    }
    this.closing = true;
    this.scheduler.requestStop();
    this.readyRunIds.length = 0;
    await Promise.all([...this.entries.values()].map(async (entry) => await entry.session.abortForShutdown()));
    await this.scheduler.waitForIdle();
    this.entries.clear();
    this.activeRunId = null;
    this.onQueueChange(null);
  }

  private async runExecution(entry: MutableServerScrapeQueueEntry<TManualScrape>): Promise<void> {
    try {
      const sessionStatus = entry.session.snapshot().status;
      if (sessionStatus === "queued") await entry.session.start();
      else if (sessionStatus === "paused") await entry.session.resume();
      else throw new Error(`Cannot schedule scrape session in ${sessionStatus} state: ${entry.runId}`);
      await entry.session.waitForIdle();
      if (this.closing) return;
      const snapshot = entry.session.snapshot();
      if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "stopped") {
        await this.settleAndRemove(entry, snapshot);
      }
    } finally {
      if (this.activeRunId === entry.runId) this.activeRunId = null;
    }
  }

  private async settleAndRemove(
    entry: MutableServerScrapeQueueEntry<TManualScrape>,
    snapshot: ScrapeRunSnapshot<TManualScrape>,
  ): Promise<void> {
    entry.settlement ??= entry.settle(snapshot, entry.startedAt);
    await entry.settlement;
    if (this.entries.get(entry.runId) !== entry) return;
    this.entries.delete(entry.runId);
    this.removeReadyRun(entry.runId);
    this.onQueueChange(null);
  }

  private requireEntry(runId: string): MutableServerScrapeQueueEntry<TManualScrape> {
    const entry = this.entries.get(runId);
    if (!entry) throw new Error(`Scrape run is not live in this backend process: ${runId}`);
    return entry;
  }

  private removeReadyRun(runId: string): void {
    for (let index = this.readyRunIds.length - 1; index >= 0; index -= 1) {
      if (this.readyRunIds[index] === runId) this.readyRunIds.splice(index, 1);
    }
  }

  private copyEntry(entry: MutableServerScrapeQueueEntry<TManualScrape>): ServerScrapeQueueEntry<TManualScrape> {
    return {
      runId: entry.runId,
      session: entry.session,
      status: entry.status,
      createdAt: new Date(entry.createdAt),
      startedAt: entry.startedAt ? new Date(entry.startedAt) : null,
    };
  }
}
