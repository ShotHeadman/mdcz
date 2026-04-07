import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { type Configuration, configManager } from "@main/services/config";
import type { CrawlerProvider } from "@main/services/crawler";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { listVideoFiles } from "@main/utils/file";
import type { ScraperStatus } from "@shared/types";
import { createAbortError } from "./abort";
import { AggregationService } from "./aggregation";
import { DownloadManager } from "./DownloadManager";
import { fileOrganizer } from "./FileOrganizer";
import { createFileScraper } from "./FileScraper";
import { isGeneratedSidecarVideo } from "./media";
import { NfoGenerator } from "./NfoGenerator";
import { ScrapeSession } from "./session/ScrapeSession";
import { TranslateService } from "./TranslateService";

export type ScraperMode = "single" | "batch";

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

const toComparablePath = (filePath: string): string =>
  process.platform === "win32" ? filePath.toLowerCase() : filePath;

const isPathWithinDirectory = (filePath: string, directoryPath: string): boolean =>
  filePath === directoryPath || filePath.startsWith(`${directoryPath}${sep}`);

const collectComparablePaths = async (filePath: string, includeRealPath: boolean): Promise<string[]> => {
  const comparablePaths = new Set<string>([toComparablePath(resolve(filePath))]);
  if (!includeRealPath) {
    return [...comparablePaths];
  }

  try {
    comparablePaths.add(toComparablePath(await realpath(filePath)));
  } catch {
    // Ignore missing/broken realpath targets and fall back to the resolved path.
  }

  return [...comparablePaths];
};

export class ScraperService {
  private readonly logger = loggerService.getLogger("ScraperService");

  private readonly session = new ScrapeSession();

  private restGate: ScrapeRestGate | null = null;

  private readonly sharedNetworkClient: NetworkClient;

  private readonly aggregationService: AggregationService;

  constructor(
    private readonly signalService: SignalService,
    networkClient: NetworkClient,
    crawlerProvider: CrawlerProvider,
    private readonly actorImageService = new ActorImageService(),
    private readonly actorSourceProvider?: ActorSourceProvider,
  ) {
    this.sharedNetworkClient = networkClient;
    this.aggregationService = new AggregationService(crawlerProvider);
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

  async start(mode: ScraperMode, paths: string[]): Promise<StartScrapeResult> {
    if (this.session.getStatus().running) {
      throw new ScraperServiceError("ALREADY_RUNNING", "Scraper is already running");
    }

    const configuration = await configManager.getValidated();
    const filePaths = await this.resolveFilePaths(mode, uniquePaths(paths), configuration);

    if (filePaths.length === 0) {
      throw new ScraperServiceError("NO_FILES", "No files selected");
    }

    this.configureRuntimeSettings(configuration);
    const concurrency = mode === "single" ? 1 : Math.max(1, configuration.scrape.threadNumber);
    return this.beginSession(filePaths, concurrency, configuration);
  }

  stop(): { pendingCount: number } {
    if (!this.session.getStatus().running) {
      return { pendingCount: 0 };
    }

    this.signalService.setButtonStatus(false, false);
    return this.session.stop();
  }

  pause(): void {
    this.session.pause();
  }

  resume(): void {
    this.session.resume();
  }

  async requeue(filePaths: string[]): Promise<{ requeuedCount: number }> {
    if (!this.session.getStatus().running) {
      throw new ScraperServiceError("NOT_RUNNING", "Scraper is not running");
    }

    // Supports both single-item and batch manual retry from frontend.
    const pending = uniquePaths(filePaths);
    const totalFiles = Math.max(1, this.session.getStatus().totalFiles);
    const fileScraper = createFileScraper(this.createFileScraperDependencies());
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
            return fileScraper.scrapeFile(filePath, { fileIndex, totalFiles }, signal);
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
  async retryFiles(filePaths: string[]): Promise<StartScrapeResult> {
    if (this.session.getStatus().running) {
      throw new ScraperServiceError("ALREADY_RUNNING", "Scraper is already running — use requeue instead");
    }

    const pending = uniquePaths(filePaths);
    if (pending.length === 0) {
      throw new ScraperServiceError("NO_FILES", "No files to retry");
    }

    const configuration = await configManager.getValidated();

    this.configureRuntimeSettings(configuration);
    const concurrency = Math.max(1, configuration.scrape.threadNumber);
    return this.beginSession(pending, concurrency, configuration);
  }

  private async finish(taskId: string): Promise<void> {
    if (this.session.getTaskId() !== taskId || !this.session.getStatus().running) {
      return;
    }

    await this.session.finish();
    this.aggregationService.clearCache();

    this.signalService.setButtonStatus(true, false);
    this.logger.info(`Scrape task finished: ${taskId}`);
  }

  private async resolveFilePaths(mode: ScraperMode, paths: string[], configuration: Configuration): Promise<string[]> {
    if (mode === "single") {
      const filePath = paths[0]?.trim();
      return filePath ? [filePath] : [];
    }

    const includeRealPathComparisons = configuration.behavior.scrapeSoftlinkPath;
    const excludePaths = await this.buildExcludedOutputPaths(paths, configuration, includeRealPathComparisons);
    const candidatePaths = await this.collectBatchCandidateFiles(paths, configuration);
    const filteredOutputPaths = await this.filterExcludedBatchFiles(
      candidatePaths,
      excludePaths,
      includeRealPathComparisons,
    );
    const skippedCount = candidatePaths.length - filteredOutputPaths.length;
    if (skippedCount > 0) {
      this.logger.info(
        `Skipped ${skippedCount} file(s) in output directories or generated sidecars from batch scrape queue`,
      );
    }

    return filteredOutputPaths;
  }

  private async buildExcludedOutputPaths(
    scanRoots: string[],
    configuration: Configuration,
    includeRealPathComparisons: boolean,
  ): Promise<Set<string>> {
    const excludePaths = new Set<string>();
    const successFolder = configuration.paths.successOutputFolder.trim();
    const failedFolder = configuration.paths.failedOutputFolder.trim();
    const mediaRoot = configuration.paths.mediaPath.trim();

    for (const dirPath of scanRoots) {
      const base = mediaRoot.length > 0 ? mediaRoot : dirPath;
      for (const outputFolder of [successFolder, failedFolder]) {
        if (!outputFolder) {
          continue;
        }

        for (const comparablePath of await collectComparablePaths(
          resolve(base, outputFolder),
          includeRealPathComparisons,
        )) {
          excludePaths.add(comparablePath);
        }
      }
    }

    return excludePaths;
  }

  private async collectBatchCandidateFiles(paths: string[], configuration: Configuration): Promise<string[]> {
    const outputs: string[] = [];

    for (const dirPath of paths) {
      try {
        outputs.push(...(await listVideoFiles(dirPath, true)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ScraperServiceError("DIR_NOT_FOUND", message);
      }
    }

    outputs.push(...(await this.collectSoftlinkFiles(configuration)));
    return uniquePaths(outputs);
  }

  private async filterExcludedBatchFiles(
    filePaths: string[],
    excludePaths: Set<string>,
    includeRealPathComparisons: boolean,
  ): Promise<string[]> {
    const filteredPaths: string[] = [];

    for (const filePath of filePaths) {
      if (isGeneratedSidecarVideo(filePath)) {
        continue;
      }

      const comparablePaths = await collectComparablePaths(filePath, includeRealPathComparisons);
      const isExcluded = comparablePaths.some((candidatePath) => {
        for (const excludePath of excludePaths) {
          if (isPathWithinDirectory(candidatePath, excludePath)) {
            return true;
          }
        }

        return false;
      });
      if (!isExcluded) {
        filteredPaths.push(filePath);
      }
    }

    return filteredPaths;
  }

  private async collectSoftlinkFiles(configuration: Configuration): Promise<string[]> {
    if (!configuration.behavior.scrapeSoftlinkPath) {
      return [];
    }

    const softlinkDir = configuration.paths.softlinkPath.trim();
    if (!softlinkDir) {
      return [];
    }

    try {
      const softlinkFiles = await listVideoFiles(softlinkDir, true);
      this.logger.info(`Scanned softlink path "${softlinkDir}": found ${softlinkFiles.length} files`);
      return softlinkFiles;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to scan softlink path "${softlinkDir}": ${message}`);
      return [];
    }
  }

  private createFileScraperDependencies() {
    return {
      aggregationService: this.aggregationService,
      translateService: new TranslateService(this.sharedNetworkClient),
      nfoGenerator: new NfoGenerator(),
      downloadManager: new DownloadManager(this.sharedNetworkClient),
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

  private beginSession(filePaths: string[], concurrency: number, configuration: Configuration): StartScrapeResult {
    const taskId = this.session.begin(filePaths, concurrency);
    this.restGate = this.createRestGate(configuration);

    this.signalService.setButtonStatus(false, true);
    this.signalService.resetProgress();

    const fileScraper = createFileScraper(this.createFileScraperDependencies());

    for (const [index, filePath] of filePaths.entries()) {
      const fileIndex = index + 1;
      this.session.addTask({
        sourcePath: filePath,
        isRetry: false,
        taskFn: async (signal) => {
          await this.restGate?.waitBeforeStart(signal);
          return fileScraper.scrapeFile(filePath, { fileIndex, totalFiles: filePaths.length }, signal);
        },
      });
    }

    void this.session.onIdle().then(() => {
      this.restGate = null;
      void this.finish(taskId);
    });

    return {
      taskId,
      totalFiles: filePaths.length,
    };
  }
}
