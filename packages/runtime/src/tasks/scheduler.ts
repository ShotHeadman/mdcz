export interface SchedulableExecution {
  id: string;
}

export class TaskScheduler<TExecution extends SchedulableExecution> {
  private activeDrain: Promise<void> | null = null;
  private stopRequested = false;

  constructor(
    private readonly deps: {
      claimNext: () => Promise<TExecution | null>;
      runExecution: (execution: TExecution) => Promise<void>;
      onExecutionError?: (execution: TExecution, error: unknown) => Promise<void> | void;
    },
  ) {}

  drain(): void {
    void this.drainAsync();
  }

  drainAsync(): Promise<void> {
    if (this.stopRequested) return Promise.resolve();
    if (this.activeDrain) return this.activeDrain;

    this.activeDrain = this.runDrain();
    return this.activeDrain;
  }

  async waitForIdle(): Promise<void> {
    await this.activeDrain;
  }

  requestStop(): void {
    this.stopRequested = true;
  }

  get isRunning(): boolean {
    return this.activeDrain !== null;
  }

  private async runDrain(): Promise<void> {
    try {
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
    } finally {
      this.activeDrain = null;
    }
  }
}
