import type { ScrapeResult } from "@mdcz/shared/types";
import { type ScrapeRunItem, ScrapeRunSession, type ScrapeRunSnapshot } from "./ScrapeRunSession";

export interface ScrapeRunLifecycleManifest {
  id: string;
}

export interface ScrapeRunLifecycleFinalizeOptions {
  startedAt?: Date | null;
}

/**
 * Everything needed to bridge one durable scrape record to the shared session
 * state machine. Host-specific values stay closed over by these callbacks.
 */
export interface ScrapeRunLifecycleRun<TManifest extends ScrapeRunLifecycleManifest, TManualScrape = unknown> {
  manifest: TManifest;
  items: readonly ScrapeRunItem<TManualScrape>[];
  concurrency: number;
  executeItem(item: ScrapeRunItem<TManualScrape>, signal: AbortSignal): Promise<ScrapeResult>;
  commitItem(item: ScrapeRunItem<TManualScrape>, result: ScrapeResult): Promise<ScrapeResult>;
  finalize(snapshot: ScrapeRunSnapshot<TManualScrape>, options: ScrapeRunLifecycleFinalizeOptions): Promise<void>;
  onSnapshot?(snapshot: ScrapeRunSnapshot<TManualScrape>): void;
}

const isTerminal = (status: ScrapeRunSnapshot["status"]): boolean =>
  status === "completed" || status === "failed" || status === "stopped";

/**
 * Owns the shared hand-off from durable run creation to ScrapeRunSession and
 * terminal persistence. Queue admission, paths, IPC, and UI remain with each host.
 */
export class ScrapeRunLifecycle<TManifest extends ScrapeRunLifecycleManifest, TManualScrape = unknown> {
  readonly manifest: TManifest;
  readonly session: ScrapeRunSession<TManualScrape>;
  private finalization: Promise<void> | null = null;

  private constructor(private readonly run: ScrapeRunLifecycleRun<TManifest, TManualScrape>) {
    this.manifest = run.manifest;
    this.session = new ScrapeRunSession({
      runId: run.manifest.id,
      items: run.items,
      concurrency: run.concurrency,
      executeItem: run.executeItem,
      commitItem: run.commitItem,
      onSnapshot: run.onSnapshot ?? (() => undefined),
    });
  }

  static async create<TManifest extends ScrapeRunLifecycleManifest, TManualScrape = unknown>(
    createRun: () => Promise<ScrapeRunLifecycleRun<TManifest, TManualScrape>>,
  ): Promise<ScrapeRunLifecycle<TManifest, TManualScrape>> {
    const run = await createRun();
    if (!run.manifest.id.trim()) throw new Error("Scrape run ID must not be empty");
    return new ScrapeRunLifecycle(run);
  }

  async finalize(
    snapshot: ScrapeRunSnapshot<TManualScrape> = this.session.snapshot(),
    options: ScrapeRunLifecycleFinalizeOptions = {},
  ): Promise<void> {
    if (snapshot.runId !== this.manifest.id) {
      throw new Error(`Scrape snapshot run ID does not match lifecycle: ${snapshot.runId}`);
    }
    if (!isTerminal(snapshot.status)) {
      throw new Error(`Cannot finalize scrape run in ${snapshot.status} state: ${snapshot.runId}`);
    }
    this.finalization ??= this.run.finalize(snapshot, options);
    await this.finalization;
  }
}
