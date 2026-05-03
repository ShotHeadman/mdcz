import { join } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { type Configuration, configManager } from "@main/services/config";
import {
  createImageHostCooldownStore,
  type PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";
import type { CrawlerProvider } from "@main/services/crawler";
import { loggerService } from "@main/services/LoggerService";
import { OutputLibraryScanner } from "@main/services/library";
import type { NetworkClient } from "@main/services/network";
import { DesktopPersistenceService } from "@main/services/persistence";
import type { SignalService } from "@main/services/SignalService";
import { didPromiseTimeout } from "@main/utils/async";
import { toErrorMessage } from "@main/utils/common";
import { createDesktopOutputRoot, resolveDesktopOutputRootPath, toLibraryAssets } from "@mdcz/runtime/library";
import {
  applyScrapeNetworkPolicy,
  createScrapeExecutionPolicy,
  type ScrapeRestGate,
  TranslateService,
} from "@mdcz/runtime/scrape";
import { ScrapeSession, type ScrapeSuccessItem } from "@mdcz/runtime/tasks";
import type { ScraperStatus } from "@mdcz/shared/types";
import { toRootRelativePath } from "@mdcz/storage";
import { app } from "electron";
import { AggregationService } from "./aggregation";
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

  private readonly session = new ScrapeSession({
    logger: loggerService.getLogger("ScrapeSession"),
    statePath: join(app.getPath("userData"), "session-state.json"),
  });

  private restGate: ScrapeRestGate | null = null;

  private readonly actorImageService: ActorImageService;

  private readonly actorSourceProvider: ActorSourceProvider | undefined;

  private readonly sharedNetworkClient: NetworkClient;

  private readonly aggregationService: AggregationService;

  private readonly imageHostCooldownStore: PersistentCooldownStore;

  private currentRunPromise: Promise<void> | null = null;

  constructor(
    private readonly signalService: SignalService,
    networkClient: NetworkClient,
    crawlerProvider: CrawlerProvider,
    actorImageService?: ActorImageService,
    actorSourceProvider?: ActorSourceProvider,
    imageHostCooldownStore?: PersistentCooldownStore,
    private readonly outputLibraryScanner = new OutputLibraryScanner(),
    private readonly persistenceService = new DesktopPersistenceService(),
  ) {
    this.actorImageService = actorImageService ?? new ActorImageService();
    this.actorSourceProvider = actorSourceProvider;
    this.sharedNetworkClient = networkClient;
    this.aggregationService = new AggregationService(crawlerProvider, { logger: this.logger });
    this.imageHostCooldownStore = imageHostCooldownStore ?? createImageHostCooldownStore();
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

    return this.retryFiles(files);
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
    return this.beginSession(filePaths, configuration, "single", undefined, { concurrency: 1 });
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

  stop(): { pendingCount: number } {
    if (!this.session.getStatus().running) {
      return { pendingCount: 0 };
    }

    this.signalService.setButtonStatus(false, false);
    return this.session.stop();
  }

  async waitForIdle(): Promise<void> {
    await (this.currentRunPromise ?? Promise.resolve());
  }

  async shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = Math.max(0, Math.trunc(options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS));
    if (this.session.getStatus().running) {
      this.logger.info("Shutting down scraper service");
      this.stop();
      const timedOut = this.currentRunPromise ? await didPromiseTimeout(this.currentRunPromise, timeoutMs) : false;
      if (timedOut) {
        this.logger.warn(`Timed out waiting ${timeoutMs}ms for scraper service shutdown`);
      }
    }

    await this.imageHostCooldownStore.flush();
  }

  pause(): void {
    this.session.pause();
  }

  resume(): void {
    this.session.resume();
  }

  async requeue(filePaths: string[], manualScrape?: ManualScrapeOptions): Promise<{ requeuedCount: number }> {
    if (!this.session.getStatus().running) {
      throw new ScraperServiceError("NOT_RUNNING", "Scraper is not running");
    }

    // Supports both single-item and batch manual retry from frontend.
    const pending = uniquePaths(filePaths);
    const totalFiles = Math.max(1, this.session.getStatus().totalFiles);
    const fileScraper = createFileScraper(this.createFileScraperDependencies(), { mode: "batch" });
    const failedFiles = new Set(this.session.getFailedFiles());

    let requeuedCount = 0;
    let cursor = Math.min(this.session.getStatus().completedFiles + 1, totalFiles);

    for (const filePath of pending) {
      if (!failedFiles.has(filePath)) {
        continue;
      }

      const fileIndex = cursor;

      if (
        !this.session.addTask({
          sourcePath: filePath,
          isRetry: true,
          taskFn: async (signal) => {
            await this.restGate?.waitBeforeStart(signal);
            return manualScrape
              ? fileScraper.scrapeFile(filePath, { fileIndex, totalFiles }, signal, { manualScrape })
              : fileScraper.scrapeFile(filePath, { fileIndex, totalFiles }, signal);
          },
        })
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
    return this.startBatchExecution(pending, configuration, manualScrape);
  }

  private async finish(taskId: string): Promise<void> {
    if (this.session.getTaskId() !== taskId || !this.session.getStatus().running) {
      return;
    }

    const successItems = this.session.getSuccessItemsSnapshot();
    await this.session.finish();

    if (successItems.length > 0) {
      await this.recordLibraryEntries(successItems, taskId);
    }
    this.outputLibraryScanner.invalidate();

    this.aggregationService.clearCache();

    this.signalService.setButtonStatus(true, false);
    this.logger.info(`Scrape task finished: ${taskId}`);
  }

  private async resolveSingleFilePaths(paths: string[]): Promise<string[]> {
    return await resolveSingleFilePathsForScrape(paths);
  }

  private async resolveSelectedFilePaths(paths: string[]): Promise<string[]> {
    return await resolveSelectedFilePathsForScrape(paths);
  }

  private startBatchExecution(
    filePaths: string[],
    configuration: Configuration,
    manualScrape?: ManualScrapeOptions,
  ): StartScrapeResult {
    this.configureRuntimeSettings(configuration);
    return this.beginSession(filePaths, configuration, "batch", manualScrape);
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

  private async recordLibraryEntries(items: ScrapeSuccessItem[], taskId: string): Promise<void> {
    try {
      const state = await this.persistenceService.getState();
      const completedAt = new Date();
      const configuration = await configManager.getValidated();
      const outputRoot = createDesktopOutputRoot(configuration, completedAt);
      if (outputRoot) {
        await state.repositories.mediaRoots.upsert(outputRoot);
      }
      const output = await state.repositories.library.upsertScrapeOutput({
        taskId,
        rootId: outputRoot?.id ?? null,
        outputDirectory: resolveDesktopOutputRootPath(configuration),
        fileCount: items.length,
        totalBytes: 0,
        completedAt,
      });
      if (!outputRoot) {
        this.logger.warn("Desktop output root is not configured; skipping persisted library entries");
        return;
      }

      for (const item of items) {
        const outputPath = item.outputPath?.trim() || item.lastKnownPath?.trim();
        if (!outputPath) {
          continue;
        }
        const rootRelativePath = this.toOutputRootRelativePath(outputRoot, outputPath) ?? outputPath;

        await state.repositories.library.upsertEntry({
          mediaIdentity: item.crawlerData?.number ?? item.number,
          rootId: outputRoot.id,
          rootRelativePath,
          sourceTaskId: taskId,
          scrapeOutputId: output.id,
          title: item.crawlerData?.title ?? item.title,
          number: item.crawlerData?.number ?? item.number,
          actors: item.crawlerData?.actors ?? item.actors,
          crawlerDataJson: item.crawlerData ? JSON.stringify(item.crawlerData) : null,
          thumbnailPath: this.toOutputRootRelativePath(
            outputRoot,
            item.assets?.thumb ?? item.assets?.poster ?? item.posterPath ?? undefined,
          ),
          assets: toLibraryAssets(outputRoot, item.assets),
          lastKnownPath: rootRelativePath,
          indexedAt: completedAt,
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

  private beginSession(
    filePaths: string[],
    configuration: Configuration,
    mode: ScrapeExecutionMode,
    manualScrape?: ManualScrapeOptions,
    overrides: { concurrency?: number } = {},
  ): StartScrapeResult {
    const policy = createScrapeExecutionPolicy(configuration, { logger: this.logger });
    const taskId = this.session.begin(filePaths, overrides.concurrency ?? policy.concurrency);
    this.restGate = policy.restGate;

    this.signalService.setButtonStatus(false, true);
    this.signalService.resetProgress();

    const fileScraper = createFileScraper(this.createFileScraperDependencies(), { mode });

    for (const [index, filePath] of filePaths.entries()) {
      const fileIndex = index + 1;
      this.session.addTask({
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
      await this.finish(taskId);
    });
    const trackedRunPromise = runPromise.finally(() => {
      if (this.currentRunPromise === trackedRunPromise) {
        this.currentRunPromise = null;
      }
    });
    this.currentRunPromise = trackedRunPromise;

    return {
      taskId,
      totalFiles: filePaths.length,
    };
  }
}
