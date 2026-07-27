export interface RuntimeQueuedTask {
  id: string;
}

export class RuntimeTaskQueueRunner<TTask extends RuntimeQueuedTask> {
  private activeDrain: Promise<void> | null = null;
  private stopRequested = false;

  constructor(
    private readonly deps: {
      getNextTask: () => Promise<TTask | null>;
      runTask: (task: TTask) => Promise<void>;
    },
  ) {}

  drain(): void {
    void this.drainAsync();
  }

  drainAsync(): Promise<void> {
    if (this.stopRequested) {
      return Promise.resolve();
    }
    if (this.activeDrain) {
      return this.activeDrain;
    }

    this.activeDrain = this.runDrain();
    return this.activeDrain;
  }

  async waitForIdle(): Promise<void> {
    await this.activeDrain;
  }

  requestStop(): void {
    this.stopRequested = true;
  }

  private async runDrain(): Promise<void> {
    try {
      while (true) {
        const task = await this.deps.getNextTask();
        if (!task || this.stopRequested) {
          break;
        }
        await this.deps.runTask(task);
      }
    } finally {
      this.activeDrain = null;
    }
  }

  get isRunning(): boolean {
    return this.activeDrain !== null;
  }
}
