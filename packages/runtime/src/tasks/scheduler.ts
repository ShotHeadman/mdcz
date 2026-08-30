export interface SchedulableExecution {
  id: string;
}

export class TaskScheduler<TExecution extends SchedulableExecution> {
  private activeDrain: Promise<void> | null = null;
  private drainRequested = false;
  private stopRequested = false;

  constructor(
    private readonly deps: {
      claimNext: () => Promise<TExecution | null>;
      runExecution: (execution: TExecution) => Promise<void>;
      onExecutionError?: (execution: TExecution, error: unknown) => Promise<void> | void;
    },
  ) {}

  drain(): void {
    if (this.stopRequested) return;
    this.drainRequested = true;
    if (!this.activeDrain) {
      this.activeDrain = this.runDrain();
      void this.activeDrain.catch(() => undefined);
    }
  }

  async waitForIdle(): Promise<void> {
    while (this.activeDrain) await this.activeDrain;
  }

  requestStop(): void {
    this.stopRequested = true;
    this.drainRequested = false;
  }

  private async runDrain(): Promise<void> {
    try {
      do {
        this.drainRequested = false;
        while (!this.stopRequested) {
          const execution = await this.deps.claimNext();
          if (!execution || this.stopRequested) break;
          try {
            await this.deps.runExecution(execution);
          } catch (error) {
            if (!this.deps.onExecutionError) throw error;
            await this.deps.onExecutionError(execution, error);
          }
        }
      } while (!this.stopRequested && this.drainRequested);
    } finally {
      this.activeDrain = null;
      if (!this.stopRequested && this.drainRequested) this.drain();
    }
  }
}
