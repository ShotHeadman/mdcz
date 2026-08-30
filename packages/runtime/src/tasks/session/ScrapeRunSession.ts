import { basename } from "node:path";
import type { ScrapeResult, ScrapeResultStatus } from "@mdcz/shared/types";
import { TaskExecutor } from "../executor";

export const MAX_LIVE_SCRAPE_LOGS = 200;

export type ScrapeRunLiveStatus =
  | "queued"
  | "running"
  | "paused"
  | "stopping"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";
export type ScrapeRunItemStatus = "pending" | "processing" | "success" | "failed" | "skipped";

export interface ScrapeRunItem<TManualScrape = unknown> {
  id: string;
  rootId: string;
  relativePath: string;
  sourcePath: string;
  manualScrape?: TManualScrape;
}

export interface ScrapeRunItemSnapshot<TManualScrape = unknown> extends ScrapeRunItem<TManualScrape> {
  status: ScrapeRunItemStatus;
  error: string | null;
  result?: ScrapeResult;
}

export interface ScrapeRunProgress {
  percent: number;
  completedItems: number;
  totalItems: number;
}

export interface ScrapeRunStageSnapshot {
  stage: string;
  message: string;
  itemId: string | null;
  relativePath: string | null;
}

export interface ScrapeRunLogEntry {
  timestamp: Date;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  itemId: string | null;
  relativePath: string | null;
}

export interface ScrapeRunSnapshot<TManualScrape = unknown> {
  runId: string;
  generation: number;
  status: ScrapeRunLiveStatus;
  progress: ScrapeRunProgress;
  items: ScrapeRunItemSnapshot<TManualScrape>[];
  latestStage: ScrapeRunStageSnapshot | null;
  logs: ScrapeRunLogEntry[];
  error: string | null;
}

export interface ScrapeRunSessionOptions<TManualScrape = unknown> {
  runId: string;
  items: readonly ScrapeRunItem<TManualScrape>[];
  concurrency: number;
  acquireItem?: (item: ScrapeRunItem<TManualScrape>) => () => void;
  admitItem: (item: ScrapeRunItem<TManualScrape>) => Promise<string>;
  executeItem: (item: ScrapeRunItem<TManualScrape>, signal: AbortSignal, attemptId: string) => Promise<ScrapeResult>;
  commitItem: (item: ScrapeRunItem<TManualScrape>, result: ScrapeResult, attemptId: string) => Promise<ScrapeResult>;
  onSnapshot: (snapshot: ScrapeRunSnapshot<TManualScrape>) => void;
}

interface MutableScrapeRunItem<TManualScrape> extends ScrapeRunItem<TManualScrape> {
  status: ScrapeRunItemStatus;
  error: string | null;
  result?: ScrapeResult;
}
type ScrapeExecution = { result: ScrapeResult; release: () => void };

class StaleScrapeRunGenerationError extends Error {}

const isTerminalItemStatus = (status: ScrapeRunItemStatus): boolean =>
  status === "success" || status === "failed" || status === "skipped";

const toTerminalItemStatus = (status: ScrapeResultStatus): ScrapeRunItemStatus => {
  if (status === "success" || status === "failed" || status === "skipped") return status;
  throw new Error(`Scrape commit returned non-terminal status: ${status}`);
};

const createSkippedResult = <TManualScrape>(
  item: MutableScrapeRunItem<TManualScrape>,
  error: string,
): ScrapeResult => ({
  fileId: item.id,
  rootId: item.rootId,
  relativePath: item.relativePath,
  fileName: basename(item.sourcePath),
  status: "skipped",
  error,
  assets: [],
});

export class ScrapeRunSession<TManualScrape = unknown> {
  private readonly items: MutableScrapeRunItem<TManualScrape>[];
  private readonly itemsById: Map<string, MutableScrapeRunItem<TManualScrape>>;
  private readonly logs: ScrapeRunLogEntry[] = [];
  private generation = 0;
  private status: ScrapeRunLiveStatus = "queued";
  private latestStage: ScrapeRunStageSnapshot | null = null;
  private error: string | null = null;
  private readonly progressByItemId = new Map<string, number>();
  private readonly attemptIdByItemId = new Map<string, string>();
  private readonly shutdownController = new AbortController();
  private executor: TaskExecutor<MutableScrapeRunItem<TManualScrape>, ScrapeExecution> | null = null;
  private runPromise: Promise<void> | null = null;

  constructor(private readonly options: ScrapeRunSessionOptions<TManualScrape>) {
    if (!options.runId.trim()) throw new Error("Scrape run ID must not be empty");
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error("Scrape run concurrency must be a positive integer");
    }
    if (options.items.length === 0) throw new Error("Scrape run must contain at least one item");

    const ids = new Set<string>();
    const paths = new Set<string>();
    this.items = options.items.map((item) => {
      if (!item.id.trim()) throw new Error("Scrape item ID must not be empty");
      if (!item.rootId.trim()) throw new Error(`Scrape item root ID must not be empty: ${item.id}`);
      if (!item.relativePath.trim()) throw new Error(`Scrape item relative path must not be empty: ${item.id}`);
      if (!item.sourcePath.trim()) throw new Error(`Scrape item source path must not be empty: ${item.id}`);
      if (ids.has(item.id)) throw new Error(`Duplicate scrape item ID: ${item.id}`);
      ids.add(item.id);
      const pathKey = `${item.rootId}\u0000${item.relativePath}`;
      if (paths.has(pathKey)) throw new Error(`Duplicate scrape item path: ${item.rootId}:${item.relativePath}`);
      paths.add(pathKey);
      return { ...item, status: "pending" as const, error: null };
    });
    this.itemsById = new Map(this.items.map((item) => [item.id, item]));
  }

  async start(): Promise<void> {
    if (this.status !== "queued") throw new Error(`Cannot start scrape run in ${this.status} state`);
    this.setStatus("running");
    this.startDrain();
  }

  async pause(): Promise<ScrapeRunSnapshot<TManualScrape>> {
    if (this.status !== "running") return this.snapshot();
    this.executor?.pause();
    this.setStatus("paused");
    await this.waitForIdle();
    return this.snapshot();
  }

  async resume(): Promise<void> {
    if (this.status !== "paused") return;
    this.setStatus("running");
    this.startDrain();
  }

  async stop(): Promise<ScrapeRunSnapshot<TManualScrape>> {
    if (this.isTerminalStatus() || this.status === "stopping") return this.snapshot();
    this.setStatus("stopping");
    this.executor?.stop();
    await this.waitForIdle();
    this.generation += 1;
    this.emitSnapshot();

    for (const item of this.items) {
      if (isTerminalItemStatus(item.status)) continue;
      try {
        const attemptId = this.attemptIdByItemId.get(item.id) ?? (await this.options.admitItem(item));
        this.attemptIdByItemId.set(item.id, attemptId);
        const result = await this.options.commitItem(item, createSkippedResult(item, "刮削已停止"), attemptId);
        this.applyCommittedResult(item, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const terminalError = new AggregateError(
          [error],
          `Scrape interrupted because terminal outcome persistence failed: ${message}`,
        );
        this.error = terminalError.message;
        this.recordLog({ level: "error", message: terminalError.message });
        this.setStatus("interrupted");
        return this.snapshot();
      }
    }
    this.setStatus("stopped");
    return this.snapshot();
  }

  async waitForIdle(): Promise<void> {
    while (this.runPromise) await this.runPromise;
  }
  async abortForShutdown(): Promise<void> {
    if (this.isTerminalStatus()) return;
    this.setStatus("stopping");
    this.generation += 1;
    this.emitSnapshot();
    this.shutdownController.abort(new Error("Scrape run interrupted by shutdown"));
    this.executor?.stop();
    await this.waitForIdle();
    this.setStatus("interrupted");
  }

  snapshot(): ScrapeRunSnapshot<TManualScrape> {
    const completedItems = this.items.filter((item) => isTerminalItemStatus(item.status)).length;
    const totalItems = this.items.length;
    return {
      runId: this.options.runId,
      generation: this.generation,
      status: this.status,
      progress: {
        percent: Math.round(
          ((completedItems + [...this.progressByItemId.values()].reduce((total, percent) => total + percent / 100, 0)) /
            totalItems) *
            100,
        ),
        completedItems,
        totalItems,
      },
      items: this.items.map((item) => ({ ...item })),
      latestStage: this.latestStage ? { ...this.latestStage } : null,
      logs: this.logs.map((entry) => ({ ...entry, timestamp: new Date(entry.timestamp) })),
      error: this.error,
    };
  }

  /**
   * The session is the sole progress authority; hosts must not maintain a
   * second counter with different units.
   */
  recordProgress(itemId: string, percent: number): void {
    const item = this.itemsById.get(itemId);
    if (!item || isTerminalItemStatus(item.status)) return;
    const nextPercent = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
    if (nextPercent <= (this.progressByItemId.get(itemId) ?? 0)) return;
    this.progressByItemId.set(itemId, nextPercent);
    this.emitSnapshot();
  }

  recordStage(stage: Omit<ScrapeRunStageSnapshot, "itemId" | "relativePath"> & { itemId?: string | null }): void {
    const item = stage.itemId ? this.itemsById.get(stage.itemId) : undefined;
    this.latestStage = {
      stage: stage.stage,
      message: stage.message,
      itemId: stage.itemId ?? null,
      relativePath: item?.relativePath ?? null,
    };
    this.emitSnapshot();
  }

  recordLog(
    entry: Omit<ScrapeRunLogEntry, "timestamp" | "itemId" | "relativePath"> & {
      timestamp?: Date;
      itemId?: string | null;
    },
  ): void {
    const item = entry.itemId ? this.itemsById.get(entry.itemId) : undefined;
    this.logs.push({
      timestamp: entry.timestamp ?? new Date(),
      level: entry.level,
      message: entry.message,
      itemId: entry.itemId ?? null,
      relativePath: item?.relativePath ?? null,
    });
    if (this.logs.length > MAX_LIVE_SCRAPE_LOGS) this.logs.splice(0, this.logs.length - MAX_LIVE_SCRAPE_LOGS);
    this.emitSnapshot();
  }

  private startDrain(): void {
    if (this.runPromise || this.status !== "running") return;
    const generation = this.generation;
    const run = this.drain(generation).catch(async (error: unknown) => {
      if (error instanceof StaleScrapeRunGenerationError) return;
      await this.handleFatalError(generation, error);
    });
    const tracked = run.finally(() => {
      if (this.runPromise === tracked) this.runPromise = null;
      if (
        this.status === "running" &&
        (this.items.some((item) => item.status === "pending") ||
          this.items.every((item) => isTerminalItemStatus(item.status)))
      ) {
        this.startDrain();
      }
    });
    this.runPromise = tracked;
  }

  private async drain(generation: number): Promise<void> {
    while (this.status === "running") {
      const pending = this.items.filter((item) => item.status === "pending");
      if (pending.length === 0) {
        this.completeLiveRunIfSettled(generation);
        return;
      }

      const executor = new TaskExecutor<MutableScrapeRunItem<TManualScrape>, ScrapeExecution>({
        concurrency: this.options.concurrency,
        gate: {
          beforeItem: async (item) => {
            this.assertCurrent(generation, ["running"]);
            const attemptId = await this.options.admitItem(item);
            this.attemptIdByItemId.set(item.id, attemptId);
            item.status = "processing";
            item.error = null;
            this.emitSnapshot();
          },
          beforeResult: async () => this.assertCurrent(generation, ["running", "paused", "stopping"]),
        },
        runItem: async (item, context) => {
          const attemptId = this.attemptIdByItemId.get(item.id);
          if (!attemptId) throw new Error(`Scrape item was not admitted: ${item.id}`);
          const release = this.options.acquireItem?.(item) ?? (() => undefined);
          try {
            return { result: await this.options.executeItem(item, context.signal, attemptId), release };
          } catch (error) {
            release();
            throw error;
          }
        },
        discardResult: (_item, execution) => execution.release(),
        applyResult: async (item, execution) => {
          try {
            this.assertCurrent(generation, ["running", "paused", "stopping"]);
            const attemptId = this.attemptIdByItemId.get(item.id);
            if (!attemptId) throw new Error(`Scrape item was not admitted: ${item.id}`);
            const committed = await this.options.commitItem(item, execution.result, attemptId);
            this.assertCurrent(generation, ["running", "paused", "stopping"]);
            this.applyCommittedResult(item, committed);
          } finally {
            execution.release();
          }
        },
      });
      this.executor = executor;
      try {
        await executor.execute(pending, this.shutdownController.signal);
      } finally {
        if (this.executor === executor) this.executor = null;
      }
    }
  }

  private applyCommittedResult(item: MutableScrapeRunItem<TManualScrape>, result: ScrapeResult): void {
    item.status = toTerminalItemStatus(result.status);
    this.progressByItemId.delete(item.id);
    item.error = result.error?.trim() || null;
    item.result = result;
    this.emitSnapshot();
    if (this.runPromise === null && this.status === "running") this.startDrain();
  }

  private completeLiveRunIfSettled(generation: number): void {
    this.assertCurrent(generation, ["running"]);
    if (this.items.some((item) => !isTerminalItemStatus(item.status))) return;
    const hasSuccess = this.items.some((item) => item.status === "success");
    if (!hasSuccess && this.items.some((item) => item.status === "skipped")) {
      this.error ??= "刮削未产生成功结果";
    }
    this.setStatus(this.items.every((item) => item.status === "success") ? "completed" : "failed");
  }

  private async handleFatalError(generation: number, error: unknown): Promise<void> {
    if (generation !== this.generation || this.status === "stopping" || this.isTerminalStatus()) return;
    this.error = error instanceof Error ? error.message : String(error);
    this.recordLog({ level: "error", message: this.error });
    const skipMessage = "刮削因任务错误未执行";
    for (const item of this.items) {
      if (isTerminalItemStatus(item.status)) continue;
      try {
        const attemptId = this.attemptIdByItemId.get(item.id) ?? (await this.options.admitItem(item));
        this.attemptIdByItemId.set(item.id, attemptId);
        const result = await this.options.commitItem(item, createSkippedResult(item, skipMessage), attemptId);
        this.applyCommittedResult(item, result);
      } catch (commitError) {
        const commitMessage = commitError instanceof Error ? commitError.message : String(commitError);
        const originalMessage = error instanceof Error ? error.message : String(error);
        const terminalError = new AggregateError(
          [error, commitError],
          `${originalMessage}; terminal outcome persistence failed: ${commitMessage}`,
        );
        this.error = terminalError.message;
        this.recordLog({ level: "error", message: terminalError.message });
        this.setStatus("interrupted");
        return;
      }
    }
    this.setStatus("failed");
  }

  private assertCurrent(generation: number, allowedStatuses: readonly ScrapeRunLiveStatus[]): void {
    if (generation !== this.generation || !allowedStatuses.includes(this.status)) {
      throw new StaleScrapeRunGenerationError(`Stale scrape result for ${this.options.runId}`);
    }
  }

  private setStatus(status: ScrapeRunLiveStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emitSnapshot();
  }

  private isTerminalStatus(): boolean {
    return (
      this.status === "completed" ||
      this.status === "failed" ||
      this.status === "stopped" ||
      this.status === "interrupted"
    );
  }

  private emitSnapshot(): void {
    this.options.onSnapshot(this.snapshot());
  }
}
