export class CandidatePreview {
  private readonly scans = new Map<string, { controller: AbortController; completion: Promise<unknown> }>();
  private readonly cancelled = new Set<string>();

  async run<T>(id: string, scan: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.scans.has(id)) throw new Error(`Preview is already running: ${id}`);
    const controller = new AbortController();
    if (this.cancelled.has(id)) controller.abort();
    const completion = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return scan(controller.signal);
    });
    this.scans.set(id, { controller, completion });
    try {
      return await completion;
    } finally {
      this.scans.delete(id);
    }
  }

  async cancel(id: string): Promise<void> {
    // Cancellation can reach the host before its scan request over a separate transport call.
    this.cancelled.add(id);
    const oldest = this.cancelled.values().next();
    if (this.cancelled.size > 256 && !oldest.done) this.cancelled.delete(oldest.value);
    const scan = this.scans.get(id);
    if (!scan) return;
    scan.controller.abort();
    await scan.completion.catch(() => undefined);
  }
}
