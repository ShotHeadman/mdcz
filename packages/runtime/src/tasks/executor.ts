export type TaskExecutorOutcome = "settled" | "paused" | "stopped";

export interface TaskExecutorSummary {
  outcome: TaskExecutorOutcome;
  startedCount: number;
  settledCount: number;
  pendingCount: number;
}

export interface TaskExecutorContext {
  executionVersion: number;
  signal: AbortSignal;
}

export interface TaskExecutorGate<TItem> {
  beforeItem?(item: TItem, context: TaskExecutorContext): Promise<void>;
  beforeResult?(item: TItem, context: TaskExecutorContext): Promise<void>;
}

export class TaskExecutor<TItem, TResult> {
  private pauseRequested = false;
  private stopRequested = false;
  private activeCount = 0;
  private activeRun: Promise<TaskExecutorSummary> | null = null;
  private controller: AbortController | null = null;

  constructor(
    private readonly deps: {
      concurrency: number;
      runItem: (item: TItem, context: TaskExecutorContext) => Promise<TResult>;
      applyResult: (item: TItem, result: TResult, context: TaskExecutorContext) => Promise<unknown>;
      gate?: TaskExecutorGate<TItem>;
    },
  ) {
    if (!Number.isInteger(deps.concurrency) || deps.concurrency < 1) {
      throw new Error("TaskExecutor concurrency must be a positive integer");
    }
  }

  execute(items: readonly TItem[], executionVersion: number): Promise<TaskExecutorSummary> {
    if (this.activeRun) throw new Error("TaskExecutor is already active");

    this.pauseRequested = false;
    this.stopRequested = false;
    this.controller = new AbortController();
    const run = this.run(items, executionVersion);
    this.activeRun = run;
    const clear = () => {
      if (this.activeRun === run) {
        this.activeRun = null;
        this.controller = null;
      }
    };
    void run.then(clear, clear);
    return run;
  }

  pause(): void {
    if (this.activeRun) this.pauseRequested = true;
  }

  stop(): void {
    if (!this.activeRun || this.stopRequested) return;
    this.stopRequested = true;
    this.controller?.abort();
  }

  async waitForIdle(): Promise<void> {
    await this.activeRun;
  }

  get isIdle(): boolean {
    return this.activeRun === null;
  }

  get activeItems(): number {
    return this.activeCount;
  }

  private async run(items: readonly TItem[], executionVersion: number): Promise<TaskExecutorSummary> {
    const controller = this.controller;
    if (!controller) throw new Error("TaskExecutor controller was not initialized");

    let nextIndex = 0;
    let startedCount = 0;
    let settledCount = 0;
    const context: TaskExecutorContext = { executionVersion, signal: controller.signal };

    const worker = async (): Promise<void> => {
      while (!this.pauseRequested && !this.stopRequested) {
        const index = nextIndex;
        if (index >= items.length) return;
        nextIndex += 1;
        startedCount += 1;
        this.activeCount += 1;

        const item = items[index];
        try {
          await this.deps.gate?.beforeItem?.(item, context);
          if (this.stopRequested) continue;
          const result = await this.deps.runItem(item, context);
          await this.deps.gate?.beforeResult?.(item, context);
          await this.deps.applyResult(item, result, context);
          settledCount += 1;
        } finally {
          this.activeCount -= 1;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.deps.concurrency, items.length) }, worker));
    return {
      outcome: this.stopRequested ? "stopped" : this.pauseRequested ? "paused" : "settled",
      startedCount,
      settledCount,
      pendingCount: items.length - startedCount,
    };
  }
}
