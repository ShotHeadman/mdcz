import { randomUUID } from "node:crypto";
import { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { configurationSchema } from "@main/services/config";
import type { ConfigManager } from "@main/services/config/ConfigManager";
import { loggerService } from "@main/services/LoggerService";
import type { SignalService } from "@main/services/SignalService";
import { pathExists } from "@main/utils/file";
import { classifyMovie, isLikelyUncensoredNumber } from "@main/utils/movieClassification";
import { parseFileInfo } from "@main/utils/number";
import { buildFileId } from "@shared/mediaIdentity";
import type { CrawlerData, FileInfo, NfoLocalState, ScrapeResult } from "@shared/types";
import { isAbortError, throwIfAborted } from "./abort";
import type { AggregationResult, AggregationService } from "./aggregation";
import type { DownloadManager } from "./DownloadManager";
import type { FileOrganizer, OrganizePlan } from "./FileOrganizer";
import { resolveFileInfoWithSubtitles } from "./fileInfoWithSubtitles";
import { isGeneratedSidecarVideo } from "./generatedSidecarVideos";
import { LocalScanService } from "./maintenance/LocalScanService";
import type { NfoGenerator } from "./NfoGenerator";
import {
  applyResolvedSceneImageMetadata,
  downloadCrawlerAssets,
  organizePreparedVideo,
  prepareOutputCrawlerData,
  probeVideoMetadataOrWarn,
  updateScrapeProgress,
  writePreparedNfo,
} from "./outputPipeline";
import type { TranslateService } from "./TranslateService";

export interface FileScraperDependencies {
  configManager: ConfigManager;
  aggregationService: AggregationService;
  translateService: TranslateService;
  nfoGenerator: NfoGenerator;
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  signalService: SignalService;
  actorImageService?: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  localScanService?: Pick<LocalScanService, "scanVideo">;
}

export interface FileScrapeProgress {
  fileIndex: number;
  totalFiles: number;
}

const AGGREGATION_FAILURE_CACHE_WINDOW_MS = 1000;

export class FileScraper {
  private readonly logger = loggerService.getLogger("FileScraper");

  private readonly actorImageService: ActorImageService;
  private readonly localScanService: Pick<LocalScanService, "scanVideo">;
  private readonly aggregationPromiseCache = new Map<string, Promise<AggregationResult | null>>();
  private readonly aggregationFailureEvictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly numberExecutionChains = new Map<string, Promise<void>>();

  constructor(private readonly deps: FileScraperDependencies) {
    this.actorImageService = deps.actorImageService ?? new ActorImageService();
    this.localScanService = deps.localScanService ?? new LocalScanService();
  }

  async scrapeFile(
    filePath: string,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
  ): Promise<ScrapeResult> {
    const taskId = randomUUID();
    const parsedFileInfo = parseFileInfo(filePath);
    const fileId = buildFileId(parsedFileInfo.filePath);
    const fileInfoWithSubtitlesPromise = resolveFileInfoWithSubtitles(filePath, {
      parsedFileInfo,
    });

    this.setProgress(progress, 0);
    let fileInfo: FileInfo = parsedFileInfo;

    try {
      const configuration = configurationSchema.parse(await this.deps.configManager.get());
      const aggregationResultPromise = this.aggregateMetadata(parsedFileInfo, configuration, signal);
      // The request starts before subtitle sidecar discovery completes; attach an early
      // rejection handler so fast failures stay associated with this task instead of surfacing
      // as unhandled rejections before we await the promise below.
      void aggregationResultPromise.catch(() => undefined);
      const { fileInfo: resolvedFileInfo, subtitleSidecars } = await fileInfoWithSubtitlesPromise;
      fileInfo = resolvedFileInfo;
      return await this.runExclusiveByNumber(fileInfo.number, async () => {
        const existingNfoLocalState = await this.loadExistingNfoLocalState(fileInfo.filePath, configuration);

        this.deps.signalService.showLogText(`Starting scrape task ${taskId} for ${fileInfo.fileName}`);
        throwIfAborted(signal);

        this.deps.signalService.showScrapeInfo({
          fileInfo,
          site: configuration.scrape.enabledSites[0],
          step: "search",
        });

        const aggregationResult = await aggregationResultPromise;
        throwIfAborted(signal);

        if (!aggregationResult) {
          this.setProgress(progress, 100);
          fileInfo = await this.handleFailedFileMove(fileInfo, configuration);
          const failedResult: ScrapeResult = {
            fileId,
            fileInfo,
            status: "failed",
            error: "No crawler returned metadata",
          };
          this.deps.signalService.showScrapeResult(failedResult);
          this.deps.signalService.showFailedInfo({ fileInfo, error: "No crawler returned metadata" });
          return failedResult;
        }

        const crawlerData: CrawlerData = aggregationResult.data;
        const videoMeta = await probeVideoMetadataOrWarn({
          logger: this.logger,
          sourceVideoPath: fileInfo.filePath,
          warningPrefix: "Video probe failed",
        });

        this.setProgress(progress, 30);
        const translated = await this.translateCrawlerDataOrFallback(crawlerData, configuration, signal);
        throwIfAborted(signal);
        let plan: OrganizePlan = {
          ...this.deps.fileOrganizer.plan(fileInfo, translated, configuration, existingNfoLocalState),
          subtitleSidecars,
        };
        plan = await this.deps.fileOrganizer.ensureOutputReady(plan, fileInfo.filePath);
        throwIfAborted(signal);
        const preparedOutputData = await prepareOutputCrawlerData({
          actorImageService: this.actorImageService,
          actorSourceProvider: this.deps.actorSourceProvider,
          config: configuration,
          crawlerData: translated,
          enabled: true,
          movieDir: plan.outputDir,
          sourceVideoPath: fileInfo.filePath,
          signal,
        });
        throwIfAborted(signal);
        this.setProgress(progress, 50);

        this.deps.signalService.showScrapeInfo({
          fileInfo,
          site: translated.website,
          step: "download",
        });

        let resolvedSceneImageUrls: string[] | undefined;
        const assets = await downloadCrawlerAssets({
          config: configuration,
          crawlerData: preparedOutputData.data,
          downloadManager: this.deps.downloadManager,
          fileNumber: fileInfo.number,
          imageAlternatives: aggregationResult.imageAlternatives,
          outputDir: plan.outputDir,
          signalService: this.deps.signalService,
          sources: aggregationResult.sources,
          callbacks: {
            onResolvedSceneImageUrls: (urls) => {
              resolvedSceneImageUrls = urls;
            },
            signal,
          },
        });
        throwIfAborted(signal);
        this.setProgress(progress, 75);

        const preparedData = applyResolvedSceneImageMetadata(preparedOutputData.data, resolvedSceneImageUrls);
        const savedNfoPath = await writePreparedNfo({
          assets,
          config: configuration,
          crawlerData: preparedData,
          enabled: configuration.download.generateNfo,
          fileInfo,
          keepExisting: configuration.download.keepNfo,
          localState: existingNfoLocalState,
          logger: this.logger,
          nfoGenerator: this.deps.nfoGenerator,
          nfoPath: plan.nfoPath,
          sourceVideoPath: fileInfo.filePath,
          sources: aggregationResult.sources,
          videoMeta,
        });
        throwIfAborted(signal);
        this.setProgress(progress, 80);

        this.deps.signalService.showScrapeInfo({
          fileInfo,
          site: preparedData.website,
          step: "organize",
        });

        throwIfAborted(signal);
        const outputVideoPath = await organizePreparedVideo({
          config: configuration,
          enabled: true,
          fileInfo,
          fileOrganizer: this.deps.fileOrganizer,
          plan,
        });

        this.setProgress(progress, 100);

        const classification = classifyMovie(fileInfo, preparedData, existingNfoLocalState);
        const uncensoredAmbiguous =
          classification.uncensored &&
          !classification.umr &&
          !classification.leak &&
          !isLikelyUncensoredNumber(preparedData.number || fileInfo.number);

        const result: ScrapeResult = {
          fileId,
          fileInfo: {
            ...fileInfo,
            filePath: outputVideoPath,
          },
          status: "success",
          crawlerData: preparedData,
          videoMeta,
          outputPath: plan.outputDir,
          nfoPath: savedNfoPath,
          assets,
          sources: aggregationResult.sources,
          uncensoredAmbiguous,
        };

        this.deps.signalService.showScrapeResult(result);

        return result;
      });
    } catch (error) {
      if (isAbortError(error)) {
        this.logger.info(`Scrape aborted for ${fileInfo.filePath}`);
        this.setProgress(progress, 100);
        const skippedResult: ScrapeResult = {
          fileId,
          fileInfo,
          status: "skipped",
          error: "Operation aborted",
        };
        this.deps.signalService.showScrapeResult(skippedResult);
        return skippedResult;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Scrape failed for ${fileInfo.filePath}: ${message}`);
      this.setProgress(progress, 100);

      try {
        const cfg = configurationSchema.parse(await this.deps.configManager.get());
        fileInfo = await this.handleFailedFileMove(fileInfo, cfg);
      } catch (moveError) {
        const moveMsg = moveError instanceof Error ? moveError.message : String(moveError);
        this.logger.warn(`Failed to move file to failed folder: ${moveMsg}`);
      }

      const failedResult: ScrapeResult = {
        fileId,
        fileInfo,
        status: "failed",
        error: message,
      };
      this.deps.signalService.showScrapeResult(failedResult);
      this.deps.signalService.showFailedInfo({ fileInfo, error: message });
      return failedResult;
    }
  }

  private async translateCrawlerDataOrFallback(
    crawlerData: CrawlerData,
    configuration: Configuration,
    signal?: AbortSignal,
  ): Promise<CrawlerData> {
    throwIfAborted(signal);

    try {
      return await this.deps.translateService.translateCrawlerData(crawlerData, configuration, signal);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Translation failed for ${crawlerData.number}: ${message}`);
      return crawlerData;
    }
  }

  private async loadExistingNfoLocalState(
    filePath: string,
    configuration: Configuration,
  ): Promise<NfoLocalState | undefined> {
    if (!configuration.download.generateNfo || !configuration.download.keepNfo) {
      return undefined;
    }

    try {
      const entry = await this.localScanService.scanVideo(filePath, configuration.paths.sceneImagesFolder);
      return entry.nfoLocalState;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to read existing NFO local state for ${filePath}: ${message}`);
      return undefined;
    }
  }

  private aggregateMetadata(
    fileInfo: FileInfo,
    configuration: Configuration,
    signal?: AbortSignal,
  ): Promise<AggregationResult | null> {
    const cacheKey = fileInfo.number.trim().toUpperCase();
    if (!cacheKey || isGeneratedSidecarVideo(fileInfo.filePath)) {
      return this.deps.aggregationService.aggregate(fileInfo.number, configuration, signal);
    }

    const cached = this.aggregationPromiseCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let request: Promise<AggregationResult | null>;
    request = this.deps.aggregationService.aggregate(fileInfo.number, configuration, signal).catch((error) => {
      this.scheduleFailedAggregationEviction(cacheKey, request);
      throw error;
    });
    this.aggregationPromiseCache.set(cacheKey, request);
    return request;
  }

  private scheduleFailedAggregationEviction(cacheKey: string, request: Promise<AggregationResult | null>): void {
    const existingTimer = this.aggregationFailureEvictionTimers.get(cacheKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      if (this.aggregationPromiseCache.get(cacheKey) === request) {
        this.aggregationPromiseCache.delete(cacheKey);
      }
      this.aggregationFailureEvictionTimers.delete(cacheKey);
    }, AGGREGATION_FAILURE_CACHE_WINDOW_MS);
    timer.unref?.();
    this.aggregationFailureEvictionTimers.set(cacheKey, timer);
  }

  private setProgress(progress: FileScrapeProgress, stepPercent: number): void {
    updateScrapeProgress(this.deps.signalService, progress, stepPercent);
  }

  private async handleFailedFileMove(fileInfo: FileInfo, config: Configuration): Promise<FileInfo> {
    if (!config.behavior.failedFileMove) {
      return fileInfo;
    }
    if (!(await pathExists(fileInfo.filePath))) {
      this.logger.warn(`Skip failed-file move because source no longer exists: ${fileInfo.filePath}`);
      return fileInfo;
    }
    try {
      const movedPath = await this.deps.fileOrganizer.moveToFailedFolder(fileInfo, config);
      const movedFileInfo = parseFileInfo(movedPath);
      return {
        ...fileInfo,
        ...movedFileInfo,
        filePath: movedPath,
        isSubtitled: fileInfo.isSubtitled || movedFileInfo.isSubtitled,
        subtitleTag: fileInfo.subtitleTag ?? movedFileInfo.subtitleTag,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to move file to failed folder: ${message}`);
      return fileInfo;
    }
  }

  private async runExclusiveByNumber<T>(number: string, operation: () => Promise<T>): Promise<T> {
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
