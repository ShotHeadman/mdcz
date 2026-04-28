import PQueue from "p-queue";

export interface DomainRateLimit {
  requestsPerSecond: number;
  intervalMs?: number;
  intervalCap?: number;
  concurrency?: number;
}

interface QueueEntry {
  queue: PQueue;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_IDLE_QUEUE_TTL_MS = 60_000;

export class RateLimiter {
  private readonly defaultLimit: DomainRateLimit;

  private readonly domainLimits = new Map<string, DomainRateLimit>();

  private readonly queues = new Map<string, QueueEntry>();

  constructor(
    defaultRequestsPerSecond = 5,
    private readonly idleQueueTtlMs = DEFAULT_IDLE_QUEUE_TTL_MS,
  ) {
    this.defaultLimit = {
      requestsPerSecond: defaultRequestsPerSecond,
      concurrency: 1,
    };
  }

  setDomainLimit(domain: string, requestsPerSecond: number, concurrency = 1): void {
    this.domainLimits.set(domain, { requestsPerSecond, concurrency });
    this.disposeQueue(domain);
  }

  setDomainInterval(domain: string, intervalMs: number, intervalCap = 1, concurrency = 1): void {
    this.domainLimits.set(domain, {
      requestsPerSecond: Math.max(1, intervalCap),
      intervalMs: Math.max(1, Math.trunc(intervalMs)),
      intervalCap: Math.max(1, Math.trunc(intervalCap)),
      concurrency,
    });
    this.disposeQueue(domain);
  }

  async schedule<T>(urlOrDomain: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const domain = this.extractDomain(urlOrDomain);
    const entry = this.getOrCreateQueue(domain);
    this.clearCleanupTimer(entry);

    return entry.queue.add(task, signal ? { signal } : undefined).finally(() => {
      this.scheduleIdleCleanup(domain, entry);
    });
  }

  clear(): void {
    this.queues.forEach((entry) => {
      this.clearCleanupTimer(entry);
      entry.queue.clear();
    });
    this.queues.clear();
  }

  private getOrCreateQueue(domain: string): QueueEntry {
    const existing = this.queues.get(domain);

    if (existing) {
      return existing;
    }

    const limit = this.domainLimits.get(domain) ?? this.defaultLimit;
    const intervalMs = limit.intervalMs ? Math.max(1, Math.trunc(limit.intervalMs)) : 1000;
    const intervalCap = limit.intervalCap ?? Math.max(1, Math.trunc(limit.requestsPerSecond));
    const queue = new PQueue({
      concurrency: limit.concurrency ?? 1,
      interval: intervalMs,
      intervalCap,
    });

    const entry: QueueEntry = {
      queue,
      cleanupTimer: null,
    };
    this.queues.set(domain, entry);

    return entry;
  }

  private scheduleIdleCleanup(domain: string, entry: QueueEntry): void {
    if (
      this.idleQueueTtlMs <= 0 ||
      entry.queue.size > 0 ||
      entry.queue.pending > 0 ||
      this.queues.get(domain) !== entry
    ) {
      return;
    }

    this.clearCleanupTimer(entry);
    entry.cleanupTimer = setTimeout(() => {
      if (entry.queue.size > 0 || entry.queue.pending > 0 || this.queues.get(domain) !== entry) {
        return;
      }

      this.clearCleanupTimer(entry);
      this.queues.delete(domain);
    }, this.idleQueueTtlMs);
    entry.cleanupTimer.unref?.();
  }

  private clearCleanupTimer(entry: QueueEntry): void {
    if (!entry.cleanupTimer) {
      return;
    }

    clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = null;
  }

  private disposeQueue(domain: string): void {
    const entry = this.queues.get(domain);
    if (!entry) {
      return;
    }

    this.clearCleanupTimer(entry);
    this.queues.delete(domain);
  }

  private extractDomain(urlOrDomain: string): string {
    try {
      const normalized = urlOrDomain.startsWith("http") ? urlOrDomain : `https://${urlOrDomain}`;
      return new URL(normalized).hostname;
    } catch {
      return urlOrDomain;
    }
  }
}
