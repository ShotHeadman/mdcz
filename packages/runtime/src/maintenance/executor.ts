import type { MaintenanceStatus } from "@mdcz/shared/types";
import PQueue from "p-queue";
import { createAbortError, isAbortError } from "../scrape/utils/abort";

export type MaintenanceExecutionState = "previewing" | "executing";

export type MaintenanceExecutionItemStatus = "success" | "failed" | "skipped";

export interface MaintenanceExecutionItemResult<TResult> {
  status: MaintenanceExecutionItemStatus;
  result?: TResult;
  error?: string;
}

export interface MaintenanceExecutorCallbacks<TItem, TResult> {
  onItemStart?: (item: TItem, index: number) => void | Promise<void>;
  onItemComplete?: (
    item: TItem,
    index: number,
    result: MaintenanceExecutionItemResult<TResult>,
    status: MaintenanceStatus,
  ) => void | Promise<void>;
  onProgress?: (status: MaintenanceStatus) => void | Promise<void>;
}

export interface MaintenanceExecutorRunOptions<TItem, TResult> {
  state: MaintenanceExecutionState;
  items: readonly TItem[];
  concurrency: number;
  runItem: (item: TItem, index: number, signal: AbortSignal) => Promise<MaintenanceExecutionItemResult<TResult>>;
  callbacks?: MaintenanceExecutorCallbacks<TItem, TResult>;
}

export const createIdleMaintenanceStatus = (): MaintenanceStatus => ({
  state: "idle",
  totalEntries: 0,
  completedEntries: 0,
  successCount: 0,
  failedCount: 0,
});

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class MaintenanceExecutor {
  private status: MaintenanceStatus = createIdleMaintenanceStatus();

  private lastTerminalStatus: MaintenanceStatus = createIdleMaintenanceStatus();

  private queue: PQueue | null = null;

  private controller: AbortController | null = null;

  private pausedStateBeforePause: MaintenanceExecutionState | null = null;

  getStatus(): MaintenanceStatus {
    return { ...this.status };
  }

  isActive(): boolean {
    return this.status.state !== "idle";
  }

  wasStopped(): boolean {
    return this.lastTerminalStatus.state === "stopping";
  }

  stop(): void {
    if (!this.isActive()) {
      return;
    }

    this.status = { ...this.status, state: "stopping" };
    this.lastTerminalStatus = this.getStatus();
    this.controller?.abort(createAbortError());
    this.queue?.clear();
  }

  pause(): void {
    if ((this.status.state !== "executing" && this.status.state !== "previewing") || !this.queue) {
      return;
    }

    this.pausedStateBeforePause = this.status.state;
    this.queue.pause();
    this.status = { ...this.status, state: "paused" };
    this.lastTerminalStatus = this.getStatus();
  }

  resume(): void {
    if (this.status.state !== "paused" || !this.queue) {
      return;
    }

    this.status = { ...this.status, state: this.pausedStateBeforePause ?? "executing" };
    this.lastTerminalStatus = this.getStatus();
    this.pausedStateBeforePause = null;
    this.queue.start();
  }

  async run<TItem, TResult>(options: MaintenanceExecutorRunOptions<TItem, TResult>): Promise<TResult[]> {
    if (this.isActive()) {
      throw new Error("Maintenance executor is already running");
    }

    const totalEntries = options.items.length;
    this.status = {
      state: options.state,
      totalEntries,
      completedEntries: 0,
      successCount: 0,
      failedCount: 0,
    };
    this.controller = new AbortController();
    this.queue = new PQueue({ concurrency: Math.max(1, Math.trunc(options.concurrency)) });
    const signal = this.controller.signal;
    const completedIndexes = new Set<number>();
    const results: TResult[] = [];

    try {
      for (const [index, item] of options.items.entries()) {
        this.queue.add(async () => {
          if (signal.aborted || this.status.state === "stopping") {
            return;
          }

          await options.callbacks?.onItemStart?.(item, index);
          const itemResult = await this.runItem(options, item, index, signal);
          completedIndexes.add(index);
          this.applyItemResult(itemResult);
          if (itemResult.result !== undefined) {
            results.push(itemResult.result);
          }
          await options.callbacks?.onItemComplete?.(item, index, itemResult, this.getStatus());
          await options.callbacks?.onProgress?.(this.getStatus());
        }, undefined);
      }

      await this.queue.onIdle();
      if (this.status.state === "stopping") {
        await this.markUnfinishedAsStopped(options, completedIndexes);
      }
      this.lastTerminalStatus = this.getStatus();
      return results;
    } catch (error) {
      this.queue?.clear();
      if (isAbortError(error) || signal.aborted || this.status.state === "stopping") {
        await this.markUnfinishedAsStopped(options, completedIndexes);
        this.lastTerminalStatus = this.getStatus();
        return results;
      }
      throw error;
    } finally {
      this.lastTerminalStatus = this.status.state === "idle" ? this.lastTerminalStatus : this.getStatus();
      this.status = createIdleMaintenanceStatus();
      this.queue = null;
      this.controller = null;
      this.pausedStateBeforePause = null;
    }
  }

  private async runItem<TItem, TResult>(
    options: MaintenanceExecutorRunOptions<TItem, TResult>,
    item: TItem,
    index: number,
    signal: AbortSignal,
  ): Promise<MaintenanceExecutionItemResult<TResult>> {
    try {
      return await options.runItem(item, index, signal);
    } catch (error) {
      return {
        status: isAbortError(error) || signal.aborted ? "skipped" : "failed",
        error: toErrorMessage(error),
      };
    }
  }

  private applyItemResult<TResult>(result: MaintenanceExecutionItemResult<TResult>): void {
    this.status = {
      ...this.status,
      completedEntries: this.status.completedEntries + 1,
      successCount: this.status.successCount + (result.status === "success" ? 1 : 0),
      failedCount: this.status.failedCount + (result.status === "success" ? 0 : 1),
    };
  }

  private async markUnfinishedAsStopped<TItem, TResult>(
    options: MaintenanceExecutorRunOptions<TItem, TResult>,
    completedIndexes: Set<number>,
  ): Promise<void> {
    for (const [index, item] of options.items.entries()) {
      if (completedIndexes.has(index)) {
        continue;
      }

      const result: MaintenanceExecutionItemResult<TResult> = {
        status: "skipped",
        error: "维护已停止，项目未执行",
      };
      this.applyItemResult(result);
      await options.callbacks?.onItemComplete?.(item, index, result, this.getStatus());
      await options.callbacks?.onProgress?.(this.getStatus());
    }
  }
}
