import { ActorImageService } from "@main/services/ActorImageService";
import { type Configuration, configManager } from "@main/services/config";
import {
  createImageHostCooldownStore,
  type PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import { OutputLibraryScanner } from "@main/services/library";
import { DesktopPersistenceService } from "@main/services/persistence";
import type { SignalService } from "@main/services/SignalService";
import { didPromiseTimeout } from "@main/utils/async";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import { createDesktopOutputRoot } from "@mdcz/runtime/library";
import type { NetworkClient } from "@mdcz/runtime/network";
import {
  AggregationService,
  applyScrapeNetworkPolicy,
  createScrapeExecutionPolicy,
  TranslateService,
} from "@mdcz/runtime/scrape";
import { ScrapeRunLifecycle, type ScrapeRunSnapshot } from "@mdcz/runtime/tasks";
import type { ScraperStatus } from "@mdcz/shared/types";
import {
  type CreatedDesktopScrapeRun,
  type DesktopScrapeExecutionAdapter,
  DesktopScrapeExecutionStore,
} from "./DesktopScrapeExecutionStore";
import { DownloadManager } from "./DownloadManager";
import { createFileScraper, type ScrapeExecutionMode } from "./FileScraper";
import { fileOrganizer } from "./fileOrganizerAdapter";
import type { ManualScrapeOptions } from "./manualScrape";
import { NfoGenerator } from "./NfoGenerator";
import {
  resolveSelectedFilePaths as resolveSelectedFilePathsForScrape,
  resolveSingleFilePaths as resolveSingleFilePathsForScrape,
  uniquePaths,
} from "./pathResolver";
import { ScraperServiceError } from "./ScraperServiceError";
import { translationMappingStore } from "./translationMappingStore";

export interface StartScrapeResult {
  taskId: string;
  totalFiles: number;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

const idleStatus = (): ScraperStatus => ({
  state: "idle",
  running: false,
  totalFiles: 0,
  completedFiles: 0,
  successCount: 0,
  failedCount: 0,
  skippedCount: 0,
});

const isTerminalItem = (status: string): boolean => status === "success" || status === "failed" || status === "skipped";

type DesktopScrapeLifecycle = ScrapeRunLifecycle<CreatedDesktopScrapeRun["manifest"], ManualScrapeOptions>;

export class ScraperService {
  private readonly logger = loggerService.getLogger("ScraperService");
  private readonly executionStore: DesktopScrapeExecutionAdapter;
  private lifecycle: DesktopScrapeLifecycle | null = null;
  private readonly actorImageService: ActorImageService;
  private readonly actorSourceProvider: ActorSourceProvider | undefined;
  private readonly sharedNetworkClient: NetworkClient;
  private readonly aggregationService: AggregationService;
  private readonly imageHostCooldownStore: PersistentCooldownStore;
  private currentRunPromise: Promise<void> | null = null;
  private runStartedAt: Date | null = null;
  private shutdownRunId: string | null = null;
  private lastStatus = idleStatus();

  constructor(
    private readonly signalService: SignalService,
    networkClient: NetworkClient,
    crawlerProvider: CrawlerProvider,
    actorImageService?: ActorImageService,
    actorSourceProvider?: ActorSourceProvider,
    imageHostCooldownStore?: PersistentCooldownStore,
    private readonly outputLibraryScanner = new OutputLibraryScanner(),
    private readonly persistenceService = new DesktopPersistenceService(),
    executionStore?: DesktopScrapeExecutionAdapter,
  ) {
    this.actorImageService = actorImageService ?? new ActorImageService();
    this.actorSourceProvider = actorSourceProvider;
    this.sharedNetworkClient = networkClient;
    this.aggregationService = new AggregationService(crawlerProvider, { logger: this.logger });
    this.imageHostCooldownStore = imageHostCooldownStore ?? createImageHostCooldownStore();
    this.executionStore =
      executionStore ??
      new DesktopScrapeExecutionStore(this.persistenceService, async () => {
        return (await configManager.getValidated()).paths.mediaPath;
      });
  }

  getStatus(): ScraperStatus {
    const snapshot = this.lifecycle?.session.snapshot();
    return snapshot ? this.toScraperStatus(snapshot) : { ...this.lastStatus };
  }

  getFailedFiles(): string[] {
    return (
      this.lifecycle?.session
        ?.snapshot()
        .items.filter((item) => item.status === "failed")
        .map((item) => item.sourcePath) ?? []
    );
  }

  async startSingle(paths: string[]): Promise<StartScrapeResult> {
    this.assertNoActiveRun();
    const configuration = await configManager.getValidated();
    const filePaths = await resolveSingleFilePathsForScrape(uniquePaths(paths));
    if (filePaths.length === 0) throw new ScraperServiceError("NO_FILES", "No files selected");
    this.configureRuntimeSettings(configuration);
    return await this.beginSession(filePaths, configuration, "single", undefined, { concurrency: 1 });
  }

  async startSelectedFiles(paths: string[]): Promise<StartScrapeResult> {
    this.assertNoActiveRun();
    const configuration = await configManager.getValidated();
    const filePaths = await resolveSelectedFilePathsForScrape(uniquePaths(paths));
    if (filePaths.length === 0) throw new ScraperServiceError("NO_FILES", "No files selected");
    return await this.startBatchExecution(filePaths, configuration);
  }

  async stop(): Promise<{ pendingCount: number }> {
    const lifecycle = this.lifecycle;
    if (!lifecycle) return { pendingCount: 0 };
    const session = lifecycle.session;
    const beforeStop = session.snapshot();
    if (beforeStop.status === "completed" || beforeStop.status === "failed" || beforeStop.status === "stopped") {
      return { pendingCount: 0 };
    }
    const pendingCount = beforeStop.items.filter((item) => !isTerminalItem(item.status)).length;
    this.signalService.setButtonStatus(false, false);
    await session.stop();
    await this.finalizeCurrentRun(lifecycle);
    return { pendingCount };
  }

  async waitForIdle(): Promise<void> {
    await (this.currentRunPromise ?? Promise.resolve());
  }

  async shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = Math.max(0, Math.trunc(options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS));
    const lifecycle = this.lifecycle;
    if (lifecycle) {
      const session = lifecycle.session;
      this.logger.info("Shutting down scraper service");
      this.shutdownRunId = session.snapshot().runId;
      const shutdown = session.abortForShutdown();
      const timedOut = await didPromiseTimeout(shutdown, timeoutMs);
      if (timedOut) this.logger.warn(`Timed out waiting ${timeoutMs}ms for scraper service shutdown`);
      if (this.lifecycle === lifecycle) this.lifecycle = null;
      this.currentRunPromise = null;
      this.lastStatus = idleStatus();
    }
    await this.imageHostCooldownStore.flush();
  }

  async pause(): Promise<void> {
    await this.lifecycle?.session.pause();
  }

  async resume(): Promise<void> {
    const lifecycle = this.lifecycle;
    const session = lifecycle?.session;
    if (!session || session.snapshot().status !== "paused") return;
    await session.resume();
    this.trackRun(lifecycle);
  }

  async requeue(filePaths: string[], manualScrape?: ManualScrapeOptions): Promise<{ requeuedCount: number }> {
    const lifecycle = this.lifecycle;
    const session = lifecycle?.session;
    if (!session || !["running", "paused"].includes(session.snapshot().status)) {
      throw new ScraperServiceError("NOT_RUNNING", "Scraper is not running");
    }
    this.clearImageHostCooldownsForRetry();
    const requestedPaths = new Set(uniquePaths(filePaths));
    let requeuedCount = 0;
    for (const item of session.snapshot().items) {
      if (item.status !== "failed" || !requestedPaths.has(item.sourcePath)) continue;
      if (session.requeue(item.id, manualScrape)) requeuedCount += 1;
    }
    if (requeuedCount > 0 && session.snapshot().status === "running") {
      this.trackRun(lifecycle);
    }
    return { requeuedCount };
  }

  async retryFiles(filePaths: string[], manualScrape?: ManualScrapeOptions): Promise<StartScrapeResult> {
    this.assertNoActiveRun();
    const pending = uniquePaths(filePaths);
    if (pending.length === 0) throw new ScraperServiceError("NO_FILES", "No files to retry");
    const configuration = await configManager.getValidated();
    this.clearImageHostCooldownsForRetry();
    return await this.startBatchExecution(pending, configuration, manualScrape);
  }

  private async startBatchExecution(
    filePaths: string[],
    configuration: Configuration,
    manualScrape?: ManualScrapeOptions,
  ): Promise<StartScrapeResult> {
    this.configureRuntimeSettings(configuration);
    return await this.beginSession(filePaths, configuration, "batch", manualScrape);
  }

  private createFileScraperDependencies() {
    return {
      aggregationService: this.aggregationService,
      translateService: new TranslateService(this.sharedNetworkClient, {
        logger: loggerService.getLogger("TranslateService"),
        mappingStore: translationMappingStore,
      }),
      nfoGenerator: new NfoGenerator(),
      downloadManager: new DownloadManager(this.sharedNetworkClient, {
        imageHostCooldownStore: this.imageHostCooldownStore,
      }),
      fileOrganizer,
      signalService: this.signalService,
      actorImageService: this.actorImageService,
      actorSourceProvider: this.actorSourceProvider,
    };
  }

  private configureRuntimeSettings(configuration: Configuration): void {
    applyScrapeNetworkPolicy(this.sharedNetworkClient, configuration);
  }

  private async beginSession(
    filePaths: string[],
    configuration: Configuration,
    mode: ScrapeExecutionMode,
    manualScrape?: ManualScrapeOptions,
    overrides: { concurrency?: number } = {},
  ): Promise<StartScrapeResult> {
    const policy = createScrapeExecutionPolicy(configuration, { logger: this.logger });
    const startedAt = new Date();
    const requestedOutputRoot = createDesktopOutputRoot(configuration, startedAt);
    this.runStartedAt = startedAt;
    const lifecycle = await ScrapeRunLifecycle.create(async () => {
      const created = await this.executionStore.createRun(filePaths, mode, requestedOutputRoot);
      const items = created.items.map((item) => ({
        ...item,
        ...(manualScrape ? { manualScrape } : {}),
      }));
      const fileIndexByItemId = new Map(items.map((item, index) => [item.id, index + 1]));
      const fileScraper = createFileScraper(this.createFileScraperDependencies(), {
        mode,
        scrapeSessionId: created.manifest.id,
      });
      return {
        manifest: created.manifest,
        items,
        concurrency: overrides.concurrency ?? policy.concurrency,
        executeItem: async (item, signal) => {
          await policy.restGate?.waitBeforeStart(signal);
          const progress = {
            fileIndex: fileIndexByItemId.get(item.id) ?? 1,
            totalFiles: items.length,
          };
          return item.manualScrape
            ? fileScraper.scrapeFile(item.sourcePath, progress, signal, { manualScrape: item.manualScrape })
            : fileScraper.scrapeFile(item.sourcePath, progress, signal);
        },
        commitItem: async (item, result) => await this.executionStore.commitItem(created.manifest.id, item, result),
        finalize: async (snapshot, finalizeOptions) => {
          const disposition =
            snapshot.status === "completed" ? "completed" : snapshot.status === "stopped" ? "stopped" : "failed";
          await this.executionStore.finalizeRun(created.manifest.id, disposition, {
            error: snapshot.error,
            startedAt: finalizeOptions.startedAt ?? null,
          });
        },
      };
    });
    const session = lifecycle.session;
    this.lifecycle = lifecycle;
    this.signalService.setButtonStatus(false, true);
    this.signalService.resetProgress();
    await session.start();
    this.trackRun(lifecycle, startedAt);
    return { taskId: lifecycle.manifest.id, totalFiles: session.snapshot().items.length };
  }

  private trackRun(lifecycle: DesktopScrapeLifecycle, startedAt = this.runStartedAt ?? undefined): void {
    const runPromise = lifecycle.session.waitForIdle().then(async () => {
      await this.finalizeCurrentRun(lifecycle, startedAt);
    });
    const tracked = runPromise.finally(() => {
      if (this.currentRunPromise === tracked) this.currentRunPromise = null;
    });
    this.currentRunPromise = tracked;
  }

  private async finalizeCurrentRun(lifecycle: DesktopScrapeLifecycle, startedAt?: Date): Promise<void> {
    const snapshot = lifecycle.session.snapshot();
    if (this.shutdownRunId === snapshot.runId) return;
    if (!["completed", "failed", "stopped"].includes(snapshot.status)) {
      return;
    }
    try {
      await lifecycle.finalize(snapshot, { startedAt: startedAt ?? null });
      this.logger.info(`Scrape run finished: ${snapshot.runId}`);
    } finally {
      if (this.lifecycle === lifecycle) {
        this.lastStatus = this.toScraperStatus(snapshot);
        this.outputLibraryScanner.invalidate();
        this.aggregationService.clearCache();
        this.signalService.setButtonStatus(true, false);
        this.runStartedAt = null;
        this.lifecycle = null;
      }
    }
  }

  private toScraperStatus(snapshot: ScrapeRunSnapshot<ManualScrapeOptions>): ScraperStatus {
    const completedFiles = snapshot.items.filter((item) => isTerminalItem(item.status)).length;
    const terminal = snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "stopped";
    return {
      state:
        snapshot.status === "paused"
          ? "paused"
          : snapshot.status === "stopping"
            ? "stopping"
            : terminal
              ? "idle"
              : "running",
      running: !terminal,
      totalFiles: snapshot.items.length,
      completedFiles,
      successCount: snapshot.items.filter((item) => item.status === "success").length,
      failedCount: snapshot.items.filter((item) => item.status === "failed").length,
      skippedCount: snapshot.items.filter((item) => item.status === "skipped").length,
    };
  }

  private clearImageHostCooldownsForRetry(): void {
    this.imageHostCooldownStore.clear();
    this.logger.info("Cleared image host cooldowns for user-initiated retry");
  }

  private assertNoActiveRun(): void {
    if (this.lifecycle) throw new ScraperServiceError("ALREADY_RUNNING", "Scraper is already running");
  }
}
