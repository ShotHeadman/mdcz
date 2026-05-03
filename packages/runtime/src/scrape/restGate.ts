import { createAbortError } from "./utils/abort";

export interface ScrapeRestGateLogger {
  info(message: string): void;
}

export interface ScrapeRestGateOptions {
  restAfterCount?: number;
  restDurationMs?: number;
  restDurationSeconds?: number;
  logger?: ScrapeRestGateLogger;
}

const sleepWithAbort = (durationMs: number, signal?: AbortSignal): Promise<void> => {
  if (durationMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, durationMs);
      return;
    }

    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
};

export class ScrapeRestGate {
  private startedCount = 0;

  private gate: Promise<void> = Promise.resolve();

  constructor(
    private readonly restAfterCount: number,
    private readonly restDurationMs: number,
    private readonly logger: ScrapeRestGateLogger = console,
  ) {}

  async waitBeforeStart(signal?: AbortSignal): Promise<void> {
    if (this.restAfterCount <= 0 || this.restDurationMs <= 0) {
      return;
    }

    let release: ((value?: void | PromiseLike<void>) => void) | undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.gate;
    this.gate = next;

    await previous;

    try {
      this.startedCount += 1;
      const completedCount = this.startedCount - 1;
      const shouldRest = completedCount > 0 && completedCount % this.restAfterCount === 0;
      if (!shouldRest) {
        return;
      }

      const durationSeconds = Math.max(1, Math.round(this.restDurationMs / 1000));
      this.logger.info(`Reached ${completedCount} files; resting for ${durationSeconds}s`);
      await sleepWithAbort(this.restDurationMs, signal);
    } finally {
      release?.();
    }
  }
}

export const createScrapeRestGate = (options: ScrapeRestGateOptions): ScrapeRestGate | null => {
  const restAfterCount = Math.max(0, Math.trunc(options.restAfterCount ?? 0));
  const restDurationMs =
    options.restDurationMs === undefined
      ? Math.max(0, Math.trunc(options.restDurationSeconds ?? 0)) * 1000
      : Math.max(0, Math.trunc(options.restDurationMs));

  if (restAfterCount <= 0 || restDurationMs <= 0) {
    return null;
  }

  return new ScrapeRestGate(restAfterCount, restDurationMs, options.logger ?? console);
};
