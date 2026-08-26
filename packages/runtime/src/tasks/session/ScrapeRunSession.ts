import { basename, extname } from "node:path";
import type { ScrapeResult, ScrapeResultStatus } from "@mdcz/shared/types";
import { TaskExecutor } from "../executor";

export const MAX_LIVE_SCRAPE_LOGS = 200;

export type ScrapeRunLiveStatus = "queued" | "running" | "paused" | "stopping" | "completed" | "failed" | "stopped";
export type ScrapeRunItemStatus = "pending" | "processing" | "success" | "failed" | "skipped";

export interface ScrapeRunItem<TManualScrape = unknown> {
  id: string;
  rootId: string;
  relativePath: string;
  sourcePath: string;
  attempt: number;
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
  executeItem: (item: ScrapeRunItem<TManualScrape>, signal: AbortSignal) => Promise<ScrapeResult>;
  commitItem: (item: ScrapeRunItem<TManualScrape>, result: ScrapeResult) => Promise<ScrapeResult>;
  onSnapshot: (snapshot: ScrapeRunSnapshot<TManualScrape>) => void;
}

interface MutableScrapeRunItem<TManualScrape> extends ScrapeRunItem<TManualScrape> {
  status: ScrapeRunItemStatus;
  error: string | null;
  result?: ScrapeResult;
}

class StaleScrapeRunGenerationError extends Error {}

const isTerminalItemStatus = (status: ScrapeRunItemStatus): boolean =>
  status === "success" || status === "failed" || status === "skipped";

const toTerminalItemStatus = (status: ScrapeResultStatus): ScrapeRunItemStatus => {
  if (status === "success" || status === "failed" || status === "skipped") return status;
  throw new Error(`Scrape commit returned non-terminal status: ${status}`);
};

const createSkippedResult = <TManualScrape>(item: MutableScrapeRunItem<TManualScrape>, error: string): ScrapeResult => {
  const extension = extname(item.sourcePath);
  const fileName = basename(item.sourcePath);
  return {
    fileId: item.id,
    fileInfo: {
      filePath: item.sourcePath,
      fileName,
      extension,
      number: basename(fileName, extension),
      isSubtitled: false,
    },
    status: "skipped",
    error,
  };
};

export class ScrapeRunSession<TManualScrape = unknown> {
  private readonly items: MutableScrapeRunItem<TManualScrape>[];
  private readonly itemsById: Map<string, MutableScrapeRunItem<TManualScrape>>;
  private readonly logs: ScrapeRunLogEntry[] = [];
  private generation = 0;
  private status: ScrapeRunLiveStatus = "queued";
  private latestStage: ScrapeRunStageSnapshot | null = null;
  private error: string | null = null;
  private reportedPercent = 0;
  private executor: TaskExecutor<MutableScrapeRunItem<TManualScrape>, ScrapeResult> | null = null;
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
      if (!Number.isSafeInteger(item.attempt) || item.attempt < 1) {
        throw new Error(`Scrape item attempt must be a positive integer: ${item.id}`);
      }
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
    this.executor?.resume();
    this.startDrain();
  }

  async stop(): Promise<ScrapeRunSnapshot<TManualScrape>> {
    if (this.isTerminalStatus() || this.status === "stopping") return this.snapshot();
    this.setStatus("stopping");
    this.executor?.stop();
    await this.waitForIdle();
    this.generation += 1;
    this.emitSnapshot();

    let firstError: unknown;
    for (const item of this.items) {
      if (isTerminalItemStatus(item.status)) continue;
      try {
        const result = await this.options.commitItem(item, createSkippedResult(item, "刮削已停止"));
        this.applyCommittedResult(item, result);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) {
      this.error = firstError instanceof Error ? firstError.message : String(firstError);
      this.setStatus("failed");
      throw firstError;
    }
    this.setStatus("stopped");
    return this.snapshot();
  }

  requeue(itemId: string, manualScrape?: TManualScrape): boolean {
    if (this.status !== "running" && this.status !== "paused") return false;
    const item = this.itemsById.get(itemId);
    if (!item || (item.status !== "failed" && item.status !== "skipped")) return false;
    item.attempt += 1;
    if (manualScrape !== undefined) item.manualScrape = manualScrape;
    item.status = "pending";
    item.error = null;
    delete item.result;
    this.emitSnapshot();
    if (this.status === "running") this.startDrain();
    return true;
  }

  async waitForIdle(): Promise<void> {
    while (this.runPromise) await this.runPromise;
  }

  async abortForShutdown(): Promise<void> {
    if (this.isTerminalStatus()) return;
    this.setStatus("stopping");
    this.executor?.stop();
    await this.waitForIdle();
    this.generation += 1;
    this.emitSnapshot();
    this.setStatus("stopped");
  }

  snapshot(): ScrapeRunSnapshot<TManualScrape> {
    const completedItems = this.items.filter((item) => isTerminalItemStatus(item.status)).length;
    const totalItems = this.items.length;
    return {
      runId: this.options.runId,
      generation: this.generation,
      status: this.status,
      progress: {
        percent: Math.max(Math.round((completedItems / totalItems) * 100), Math.round(this.reportedPercent)),
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
  recordProgress(percent: number): void {
    const nextPercent = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
    if (nextPercent <= this.reportedPercent) return;
    this.reportedPercent = nextPercent;
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

      const executor = new TaskExecutor<MutableScrapeRunItem<TManualScrape>, ScrapeResult>({
        concurrency: this.options.concurrency,
        gate: {
          beforeItem: async (item) => {
            this.assertCurrent(generation, ["running"]);
            item.status = "processing";
            item.error = null;
            this.emitSnapshot();
          },
          beforeResult: async () => this.assertCurrent(generation, ["running", "paused"]),
        },
        runItem: async (item, context) => await this.options.executeItem(item, context.signal),
        applyResult: async (item, result) => {
          this.assertCurrent(generation, ["running", "paused"]);
          const committed = await this.options.commitItem(item, result);
          this.assertCurrent(generation, ["running", "paused", "stopping"]);
          this.applyCommittedResult(item, committed);
        },
      });
      this.executor = executor;
      try {
        const summary = await executor.execute(pending, generation);
        if (summary.outcome !== "settled") return;
      } finally {
        if (this.executor === executor) this.executor = null;
      }
    }
  }

  private applyCommittedResult(item: MutableScrapeRunItem<TManualScrape>, result: ScrapeResult): void {
    item.status = toTerminalItemStatus(result.status);
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
    this.setStatus(hasSuccess ? "completed" : "failed");
  }

  private async handleFatalError(generation: number, error: unknown): Promise<void> {
    if (generation !== this.generation || this.status === "stopping" || this.isTerminalStatus()) return;
    this.error = error instanceof Error ? error.message : String(error);
    this.recordLog({ level: "error", message: this.error });
    const skipMessage = "刮削因任务错误未执行";
    for (const item of this.items) {
      if (isTerminalItemStatus(item.status)) continue;
      try {
        const result = await this.options.commitItem(item, createSkippedResult(item, skipMessage));
        this.applyCommittedResult(item, result);
      } catch {
        // Preserve the manifest-only interrupted state when terminal persistence is unavailable.
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
    return this.status === "completed" || this.status === "failed" || this.status === "stopped";
  }

  private emitSnapshot(): void {
    this.options.onSnapshot(this.snapshot());
  }
}
