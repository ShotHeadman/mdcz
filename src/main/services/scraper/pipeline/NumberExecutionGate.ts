export class NumberExecutionGate {
  private readonly numberExecutionChains = new Map<string, Promise<void>>();

  async runExclusive<T>(number: string, operation: () => Promise<T>): Promise<T> {
    const lockKey = number.trim().toUpperCase();
    const previous = this.numberExecutionChains.get(lockKey) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => undefined).then(async () => await current);
    this.numberExecutionChains.set(lockKey, chain);

    await previous.catch(() => undefined);

    try {
      return await operation();
    } finally {
      release?.();
      if (this.numberExecutionChains.get(lockKey) === chain) {
        this.numberExecutionChains.delete(lockKey);
      }
    }
  }
}
