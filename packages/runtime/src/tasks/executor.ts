export interface TaskExecutorContext {
  signal: AbortSignal;
}

export interface TaskExecutorGate<TItem> {
  beforeItem?(item: TItem, context: TaskExecutorContext): Promise<void>;
  beforeResult?(item: TItem, context: TaskExecutorContext): Promise<void>;
}

export class TaskExecutor<TItem, TResult> {
  private pauseRequested = false;
  private stopRequested = false;
  private activeRun: Promise<void> | null = null;
  private controller: AbortController | null = null;

  constructor(
    private readonly deps: {
      concurrency: number;
      runItem: (item: TItem, context: TaskExecutorContext) => Promise<TResult>;
      applyResult: (item: TItem, result: TResult, context: TaskExecutorContext) => Promise<unknown>;
      finalizeResult?: (item: TItem, result: TResult, context: TaskExecutorContext) => Promise<unknown> | unknown;
      onFinalizeError?: (item: TItem, error: unknown) => Promise<unknown> | unknown;
      gate?: TaskExecutorGate<TItem>;
    },
  ) {
    if (!Number.isInteger(deps.concurrency) || deps.concurrency < 1) {
      throw new Error("TaskExecutor concurrency must be a positive integer");
    }
  }

  execute(items: readonly TItem[], signal?: AbortSignal): Promise<void> {
    if (this.activeRun) throw new Error("TaskExecutor is already active");

    this.pauseRequested = false;
    this.stopRequested = false;
    this.controller = new AbortController();
    const run = this.run(items, signal);
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

  private async run(items: readonly TItem[], signal?: AbortSignal): Promise<void> {
    const controller = this.controller;
    if (!controller) throw new Error("TaskExecutor controller was not initialized");

    let nextIndex = 0;
    let fatalError: unknown;
    const context: TaskExecutorContext = {
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
    };

    const worker = async (): Promise<void> => {
      while (!this.pauseRequested && !this.stopRequested && fatalError === undefined) {
        const index = nextIndex;
        if (index >= items.length) return;
        nextIndex += 1;

        const item = items[index];
        let result: TResult | undefined;
        let hasResult = false;
        try {
          await this.deps.gate?.beforeItem?.(item, context);
          if (this.stopRequested || fatalError !== undefined) continue;
          result = await this.deps.runItem(item, context);
          hasResult = true;
          if (this.stopRequested || fatalError !== undefined) continue;
          await this.deps.gate?.beforeResult?.(item, context);
          if (this.stopRequested || fatalError !== undefined) continue;
          await this.deps.applyResult(item, result, context);
        } catch (error) {
          if (fatalError === undefined) {
            fatalError = error;
            controller.abort(error);
          }
        } finally {
          if (hasResult) {
            try {
              await this.deps.finalizeResult?.(item, result as TResult, context);
            } catch (error) {
              try {
                await this.deps.onFinalizeError?.(item, error);
              } catch {
                // Finalization is best-effort and must not replace the execution error.
              }
            }
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.deps.concurrency, items.length) }, worker));
    if (fatalError !== undefined) throw fatalError;
  }
}
