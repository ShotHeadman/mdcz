import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { type Configuration, configManager } from "@main/services/config";
import {
  createImageHostCooldownStore,
  type PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";
import type { CrawlerProvider } from "@main/services/crawler";
import { RecentAcquisitionsStore } from "@main/services/history";
import { loggerService } from "@main/services/LoggerService";
import { OutputLibraryScanner } from "@main/services/library";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { didPromiseTimeout } from "@main/utils/async";
import { toErrorMessage } from "@main/utils/common";
import { DEFAULT_VIDEO_EXTENSIONS, listVideoFiles } from "@main/utils/file";
import { isGeneratedSidecarVideo, TranslateService } from "@mdcz/runtime/scrape";
import { ScrapeSession } from "@mdcz/runtime/tasks";
import type { ScraperStatus } from "@mdcz/shared/types";
import { app } from "electron";
import { createAbortError } from "./abort";
import { AggregationService } from "./aggregation";
import { DownloadManager } from "./DownloadManager";
import { createFileScraper, type ScrapeExecutionMode } from "./FileScraper";
import { fileOrganizer } from "./fileOrganizerAdapter";
import type { ManualScrapeOptions } from "./manualScrape";
import { NfoGenerator } from "./NfoGenerator";
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

export class ScraperServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_DOMAIN_RPS = 5;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
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

class ScrapeRestGate {
  private startedCount = 0;

  private gate: Promise<void> = Promise.resolve();

  constructor(
    private readonly restAfterCount: number,
    private readonly restDurationMs: number,
    private readonly logger: ReturnType<typeof loggerService.getLogger>,
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

const uniquePaths = (paths: string[]): string[] => {
  const outputs: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    outputs.push(trimmed);
  }
  return outputs;
};

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
    private readonly recentAcquisitionsStore = new RecentAcquisitionsStore(),
    private readonly outputLibraryScanner = new OutputLibraryScanner(),
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
    return this.beginSession(filePaths, 1, configuration, "single");
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
      await this.recentAcquisitionsStore.recordBatch(successItems);
    }
    this.outputLibraryScanner.invalidate();

    this.aggregationService.clearCache();

    this.signalService.setButtonStatus(true, false);
    this.logger.info(`Scrape task finished: ${taskId}`);
  }

  private async resolveSingleFilePaths(paths: string[]): Promise<string[]> {
    const filePath = paths[0]?.trim();
    if (!filePath) {
      return [];
    }

    try {
      const targetStats = await stat(filePath);
      if (!targetStats.isDirectory()) {
        return [filePath];
      }
    } catch {
      throw new ScraperServiceError("FILE_NOT_FOUND", `Selected media file not found: ${filePath}`);
    }

    let candidatePaths: string[];
    try {
      candidatePaths = (await listVideoFiles(filePath, false)).filter(
        (candidatePath) => !isGeneratedSidecarVideo(candidatePath),
      );
    } catch (error) {
      throw new ScraperServiceError("DIR_NOT_FOUND", toErrorMessage(error));
    }

    if (candidatePaths.length === 0) {
      return [];
    }

    if (candidatePaths.length > 1) {
      throw new ScraperServiceError("MULTIPLE_FILES", "Directory contains multiple media files; choose a file path");
    }

    return candidatePaths;
  }

  private async resolveSelectedFilePaths(paths: string[]): Promise<string[]> {
    const outputs: string[] = [];

    for (const filePath of uniquePaths(paths)) {
      let targetStats: Awaited<ReturnType<typeof stat>>;
      try {
        targetStats = await stat(filePath);
      } catch {
        throw new ScraperServiceError("FILE_NOT_FOUND", `Selected media file not found: ${filePath}`);
      }

      if (!targetStats.isFile()) {
        throw new ScraperServiceError("FILE_NOT_FOUND", `Selected media file not found: ${filePath}`);
      }

      if (!DEFAULT_VIDEO_EXTENSIONS.has(extname(filePath).toLowerCase()) || isGeneratedSidecarVideo(filePath)) {
        continue;
      }

      outputs.push(filePath);
    }

    return outputs;
  }

  private startBatchExecution(
    filePaths: string[],
    configuration: Configuration,
    manualScrape?: ManualScrapeOptions,
  ): StartScrapeResult {
    this.configureRuntimeSettings(configuration);
    const concurrency = Math.max(1, configuration.scrape.threadNumber);
    return this.beginSession(filePaths, concurrency, configuration, "batch", manualScrape);
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
    const delaySeconds = Math.max(0, Math.trunc(configuration.scrape.javdbDelaySeconds));
    if (delaySeconds > 0) {
      const intervalMs = delaySeconds * 1000;
      this.sharedNetworkClient.setDomainInterval("javdb.com", intervalMs, 1, 1);
      this.sharedNetworkClient.setDomainInterval("www.javdb.com", intervalMs, 1, 1);
    } else {
      this.sharedNetworkClient.setDomainLimit("javdb.com", DEFAULT_DOMAIN_RPS, 1);
      this.sharedNetworkClient.setDomainLimit("www.javdb.com", DEFAULT_DOMAIN_RPS, 1);
    }
  }

  private createRestGate(configuration: Configuration): ScrapeRestGate | null {
    const restAfterCount = Math.max(0, Math.trunc(configuration.scrape.restAfterCount));
    const restDurationSeconds = Math.max(0, Math.trunc(configuration.scrape.restDuration));
    if (restAfterCount <= 0 || restDurationSeconds <= 0) {
      return null;
    }

    return new ScrapeRestGate(restAfterCount, restDurationSeconds * 1000, this.logger);
  }

  private beginSession(
    filePaths: string[],
    concurrency: number,
    configuration: Configuration,
    mode: ScrapeExecutionMode,
    manualScrape?: ManualScrapeOptions,
  ): StartScrapeResult {
    const taskId = this.session.begin(filePaths, concurrency);
    this.restGate = this.createRestGate(configuration);

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
