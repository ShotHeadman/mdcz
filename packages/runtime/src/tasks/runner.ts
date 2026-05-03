export interface RuntimeQueuedTask {
  id: string;
}

export class RuntimeTaskQueueRunner<TTask extends RuntimeQueuedTask> {
  private running = false;

  constructor(
    private readonly deps: {
      getNextTask: () => Promise<TTask | null>;
      runTask: (task: TTask) => Promise<void>;
    },
  ) {}

  drain(): void {
    void this.drainAsync();
  }

  async drainAsync(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      while (true) {
        const task = await this.deps.getNextTask();
        if (!task) {
          break;
        }
        await this.deps.runTask(task);
      }
    } finally {
      this.running = false;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }
}
