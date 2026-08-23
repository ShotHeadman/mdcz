import { stat } from "node:fs/promises";
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
import { toErrorMessage } from "@main/utils/common";
import { toRootRelativePath } from "@mdcz/media-store";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import { createDesktopOutputRoot, resolveDesktopOutputRootPath, toLibraryAssets } from "@mdcz/runtime/library";
import type { NetworkClient } from "@mdcz/runtime/network";
import {
  AggregationService,
  applyScrapeNetworkPolicy,
  createScrapeExecutionPolicy,
  type ScrapeRestGate,
  TranslateService,
} from "@mdcz/runtime/scrape";
import { ScrapeSession, type ScrapeSessionExecutionStore, type ScrapeSuccessItem } from "@mdcz/runtime/tasks";
import type { ScraperStatus } from "@mdcz/shared/types";
import { DesktopScrapeExecutionStore } from "./DesktopScrapeExecutionStore";
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

export interface RecoverableSessionInfo {
  recoverable: boolean;
  pendingCount: number;
  failedCount: number;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export class ScraperService {
  private readonly logger = loggerService.getLogger("ScraperService");

  private readonly session: ScrapeSession;

  private restGate: ScrapeRestGate | null = null;

  private readonly actorImageService: ActorImageService;

  private readonly actorSourceProvider: ActorSourceProvider | undefined;

  private readonly sharedNetworkClient: NetworkClient;

  private readonly aggregationService: AggregationService;

  private readonly imageHostCooldownStore: PersistentCooldownStore;

  private finishingRun: { scrapeSessionId: string; promise: Promise<void> } | null = null;
  private currentRunPromise: Promise<void> | null = null;

  private pauseRequested = false;

  constructor(
    private readonly signalService: SignalService,
    networkClient: NetworkClient,
    crawlerProvider: CrawlerProvider,
    actorImageService?: ActorImageService,
    actorSourceProvider?: ActorSourceProvider,
    imageHostCooldownStore?: PersistentCooldownStore,
    private readonly outputLibraryScanner = new OutputLibraryScanner(),
    private readonly persistenceService = new DesktopPersistenceService(),
    executionStore?: ScrapeSessionExecutionStore,
  ) {
    this.actorImageService = actorImageService ?? new ActorImageService();
    this.actorSourceProvider = actorSourceProvider;
    this.sharedNetworkClient = networkClient;
    this.aggregationService = new AggregationService(crawlerProvider, { logger: this.logger });
    this.imageHostCooldownStore = imageHostCooldownStore ?? createImageHostCooldownStore();
    this.session = new ScrapeSession({
      executionStore:
        executionStore ??
        new DesktopScrapeExecutionStore(this.persistenceService, async () => {
          return (await configManager.getValidated()).paths.mediaPath;
        }),
    });
  }

  getStatus(): ScraperStatus {
    return this.session.getStatus();
  }

  getFailedFiles(): string[] {
    return this.session.getFailedFiles();
  }

  async getRecoverableSession(): Promise<RecoverableSessionInfo> {
    const snapshot = await this.session.getRecoverableSnapshot();
    return {
      recoverable: Boolean(snapshot),
      pendingCount: snapshot?.pendingFiles.length ?? 0,
      failedCount: snapshot?.failedFiles.length ?? 0,
    };
  }

  async recoverSession(): Promise<StartScrapeResult> {
    if (this.session.getStatus().running) {
      throw new ScraperServiceError("ALREADY_RUNNING", "Scraper is already running");
    }

    const snapshot = await this.session.getRecoverableSnapshot();
    if (!snapshot) {
      throw new ScraperServiceError("NO_RECOVERABLE_SESSION", "No recoverable session found");
    }

    const files = uniquePaths([...snapshot.pendingFiles, ...snapshot.failedFiles]);
    if (files.length === 0) {
      throw new ScraperServiceError("NO_FILES", "No files found in recoverable session");
    }

    const configuration = await configManager.getValidated();
    this.configureRuntimeSettings(configuration);
    return await this.beginSession(files, configuration, "batch", undefined, {}, snapshot.taskId);
  }

  async discardRecoverableSession(): Promise<void> {
    if (this.session.getStatus().running) {
      throw new ScraperServiceError("ALREADY_RUNNING", "Scraper is already running");
    }

    await this.session.discardRecoverableSession();
  }

  async startSingle(paths: string[]): Promise<StartScrapeResult> {
    if (this.session.getStatus().running) {
      throw new ScraperServiceError("ALREADY_RUNNING", "Scraper is already running");
    }

    const configuration = await configManager.getValidated();
    const filePaths = await this.resolveSingleFilePaths(uniquePaths(paths));

    if (filePaths.length === 0) {
      throw new ScraperServiceError("NO_FILES", "No files selected");
    }

    this.configureRuntimeSettings(configuration);
    return await this.beginSession(filePaths, configuration, "single", undefined, { concurrency: 1 });
  }

  async startSelectedFiles(paths: string[]): Promise<StartScrapeResult> {
    if (this.session.getStatus().running) {
      throw new ScraperServiceError("ALREADY_RUNNING", "Scraper is already running");
    }

    const configuration = await configManager.getValidated();
    const filePaths = await this.resolveSelectedFilePaths(uniquePaths(paths));

    if (filePaths.length === 0) {
      throw new ScraperServiceError("NO_FILES", "No files selected");
    }

    return this.startBatchExecution(filePaths, configuration);
  }

  async stop(): Promise<{ pendingCount: number }> {
    if (!this.session.getStatus().running) {
      return { pendingCount: 0 };
    }

    this.signalService.setButtonStatus(false, false);
    this.pauseRequested = false;
    return await this.session.stop();
  }

  async waitForIdle(): Promise<void> {
    await (this.currentRunPromise ?? Promise.resolve());
  }

  async shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = Math.max(0, Math.trunc(options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS));
    if (this.session.getStatus().running) {
      this.logger.info("Shutting down scraper service");
      await this.stop();
      const timedOut = this.currentRunPromise ? await didPromiseTimeout(this.currentRunPromise, timeoutMs) : false;
      if (timedOut) {
        this.logger.warn(`Timed out waiting ${timeoutMs}ms for scraper service shutdown`);
      }
    }

    await this.imageHostCooldownStore.flush();
  }

  async pause(): Promise<void> {
    this.pauseRequested = true;
    await this.session.pause();
  }

  async resume(): Promise<void> {
    await this.session.resume();
    this.pauseRequested = false;
    const scrapeSessionId = this.session.getTaskId();
    if (!scrapeSessionId || this.session.getState() !== "running") return;
    const runPromise = this.session.onIdle().then(async () => {
      this.restGate = null;
      if (!this.pauseRequested && this.session.getState() !== "paused") await this.finish(scrapeSessionId);
    });
    const trackedRunPromise = runPromise.finally(() => {
      if (this.currentRunPromise === trackedRunPromise) this.currentRunPromise = null;
    });
    this.currentRunPromise = trackedRunPromise;
  }

  async requeue(filePaths: string[], manualScrape?: ManualScrapeOptions): Promise<{ requeuedCount: number }> {
    if (!this.session.getStatus().running) {
      throw new ScraperServiceError("NOT_RUNNING", "Scraper is not running");
    }

    this.clearImageHostCooldownsForRetry();

    // Supports both single-item and batch manual retry from frontend.
    const pending = uniquePaths(filePaths);
    const totalFiles = Math.max(1, this.session.getStatus().totalFiles);
    const fileScraper = createFileScraper(this.createFileScraperDependencies(), {
      mode: "batch",
      scrapeSessionId: this.session.getTaskId() ?? undefined,
    });
    const failedFiles = new Set(this.session.getFailedFiles());

    let requeuedCount = 0;
    let cursor = Math.min(this.session.getStatus().completedFiles + 1, totalFiles);

    for (const filePath of pending) {
      if (!failedFiles.has(filePath)) {
        continue;
      }

      const fileIndex = cursor;

      if (
        !(await this.session.addTask({
          sourcePath: filePath,
          isRetry: true,
          taskFn: async (signal) => {
            await this.restGate?.waitBeforeStart(signal);
            return manualScrape
              ? fileScraper.scrapeFile(filePath, { fileIndex, totalFiles }, signal, { manualScrape })
              : fileScraper.scrapeFile(filePath, { fileIndex, totalFiles }, signal);
          },
        }))
      ) {
        continue;
      }

      cursor = Math.min(cursor + 1, totalFiles);
      requeuedCount += 1;
    }

    return { requeuedCount };
  }

  /**
   * T12: Retry failed files as a NEW scrape task.
   * Works when the scraper is idle (unlike requeue which requires running state).
   * Starts a fresh task using the given file paths directly (no directory listing).
   */
  async retryFiles(filePaths: string[], manualScrape?: ManualScrapeOptions): Promise<StartScrapeResult> {
    if (this.session.getStatus().running) {
      throw new ScraperServiceError("ALREADY_RUNNING", "Scraper is already running — use requeue instead");
    }

    const pending = uniquePaths(filePaths);
    if (pending.length === 0) {
      throw new ScraperServiceError("NO_FILES", "No files to retry");
    }

    const configuration = await configManager.getValidated();
    this.clearImageHostCooldownsForRetry();
    return await this.startBatchExecution(pending, configuration, manualScrape);
  }

  private clearImageHostCooldownsForRetry(): void {
    this.imageHostCooldownStore.clear();
    this.logger.info("Cleared image host cooldowns for user-initiated retry");
  }

  private async finish(scrapeSessionId: string): Promise<void> {
    // A session can be awaited by more than one run promise (e.g. after resume);
    // late callers must await the in-flight finish instead of returning early,
    // otherwise waitForIdle can resolve before the completion signals are emitted.
    if (this.finishingRun?.scrapeSessionId === scrapeSessionId) {
      await this.finishingRun.promise;
      return;
    }

    if (this.session.getTaskId() !== scrapeSessionId || !this.session.getStatus().running) {
      return;
    }

    const promise = this.runFinish(scrapeSessionId);
    this.finishingRun = { scrapeSessionId, promise };
    try {
      await promise;
    } finally {
      if (this.finishingRun?.scrapeSessionId === scrapeSessionId) {
        this.finishingRun = null;
      }
    }
  }

  private async runFinish(scrapeSessionId: string): Promise<void> {
    const successItems = this.session.getSuccessItemsSnapshot();
    await this.session.finish();

    if (successItems.length > 0) {
      await this.recordLibraryEntries(successItems, scrapeSessionId);
    }
    this.outputLibraryScanner.invalidate();

    this.aggregationService.clearCache();

    this.signalService.setButtonStatus(true, false);
    this.logger.info(`Scrape session finished: ${scrapeSessionId}`);
  }

  private async resolveSingleFilePaths(paths: string[]): Promise<string[]> {
    return await resolveSingleFilePathsForScrape(paths);
  }

  private async resolveSelectedFilePaths(paths: string[]): Promise<string[]> {
    return await resolveSelectedFilePathsForScrape(paths);
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

  private async recordLibraryEntries(items: ScrapeSuccessItem[], scrapeSessionId: string): Promise<void> {
    try {
      const state = await this.persistenceService.getState();
      const completedAt = new Date();
      const configuration = await configManager.getValidated();
      const outputRoot = createDesktopOutputRoot(configuration, completedAt);
      if (outputRoot) {
        await state.repositories.mediaRoots.upsert(outputRoot);
      }
      const preparedItems = await Promise.all(
        items.map(async (item) => {
          const videoPath = item.lastKnownPath?.trim();
          if (!videoPath) {
            return { item, videoPath: null, size: 0 };
          }
          const metadata = await stat(videoPath).catch(() => null);
          return {
            item,
            videoPath,
            size: metadata?.isFile() ? metadata.size : 0,
          };
        }),
      );
      const output = await state.repositories.library.upsertScrapeOutput({
        taskId: scrapeSessionId,
        rootId: outputRoot?.id ?? null,
        outputDirectory: resolveDesktopOutputRootPath(configuration),
        fileCount: items.length,
        totalBytes: preparedItems.reduce((total, prepared) => total + prepared.size, 0),
        completedAt,
      });
      if (!outputRoot) {
        this.logger.warn("Desktop output root is not configured; skipping persisted library entries");
        return;
      }

      for (const prepared of preparedItems) {
        const { item, videoPath } = prepared;
        if (!videoPath) {
          continue;
        }
        const rootRelativePath = this.toOutputRootRelativePath(outputRoot, videoPath) ?? videoPath;

        await state.repositories.library.upsertEntry({
          mediaIdentity: item.crawlerData?.number ?? item.number,
          rootId: outputRoot.id,
          rootRelativePath,
          sourceTaskId: scrapeSessionId,
          scrapeOutputId: output.id,
          size: prepared.size,
          title: item.crawlerData?.title ?? item.title,
          number: item.crawlerData?.number ?? item.number,
          actors: item.crawlerData?.actors ?? item.actors,
          crawlerDataJson: item.crawlerData ? JSON.stringify(item.crawlerData) : null,
          thumbnailPath: this.toOutputRootRelativePath(
            outputRoot,
            item.assets?.poster ?? item.posterPath ?? item.assets?.thumb ?? undefined,
          ),
          assets: toLibraryAssets(outputRoot, item.assets),
          lastKnownPath: rootRelativePath,
          createdAt: completedAt,
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to persist desktop library entries: ${toErrorMessage(error)}`);
    }
  }

  private toOutputRootRelativePath(
    outputRoot: ReturnType<typeof createDesktopOutputRoot>,
    candidatePath: string | undefined,
  ): string | null {
    const value = candidatePath?.trim();
    if (!value) {
      return null;
    }
    if (!outputRoot) {
      return value;
    }
    try {
      return toRootRelativePath(outputRoot, value);
    } catch {
      return value;
    }
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
    recoverScrapeSessionId?: string,
  ): Promise<StartScrapeResult> {
    const policy = createScrapeExecutionPolicy(configuration, { logger: this.logger });
    const scrapeSessionId = await this.session.begin(
      filePaths,
      overrides.concurrency ?? policy.concurrency,
      recoverScrapeSessionId,
    );
    this.restGate = policy.restGate;

    this.signalService.setButtonStatus(false, true);
    this.signalService.resetProgress();

    const fileScraper = createFileScraper(this.createFileScraperDependencies(), {
      mode,
      scrapeSessionId,
    });

    for (const [index, filePath] of filePaths.entries()) {
      const fileIndex = index + 1;
      await this.session.addTask({
        sourcePath: filePath,
        isRetry: false,
        taskFn: async (signal) => {
          await this.restGate?.waitBeforeStart(signal);
          const progress = { fileIndex, totalFiles: filePaths.length };
          return manualScrape
            ? fileScraper.scrapeFile(filePath, progress, signal, { manualScrape })
            : fileScraper.scrapeFile(filePath, progress, signal);
        },
      });
    }

    const runPromise = this.session.onIdle().then(async () => {
      this.restGate = null;
      if (!this.pauseRequested && this.session.getState() !== "paused") await this.finish(scrapeSessionId);
    });
    const trackedRunPromise = runPromise.finally(() => {
      if (this.currentRunPromise === trackedRunPromise) {
        this.currentRunPromise = null;
      }
    });
    this.currentRunPromise = trackedRunPromise;

    return {
      taskId: scrapeSessionId,
      totalFiles: filePaths.length,
    };
  }
}
