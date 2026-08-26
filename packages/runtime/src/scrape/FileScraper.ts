import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import type { Website } from "@mdcz/shared/enums";
import { toErrorMessage } from "@mdcz/shared/error";
import { buildFileId } from "@mdcz/shared/mediaIdentity";
import type {
  CrawlerData,
  DownloadedAssets,
  FileInfo,
  NfoLocalState,
  ScrapeResult,
  VideoMeta,
} from "@mdcz/shared/types";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "./actorOutput";
import type { AggregationResult, AggregationService, ManualScrapeOptions } from "./aggregation";
import { canonicalizeCrawlerDataActorAliases } from "./canonicalizeActorAliases";
import type { DownloadManager } from "./download";
import { type FileOrganizer, resolveMetadataOutputDir } from "./FileOrganizer";
import { isGeneratedSidecarVideo, resolveFileInfoWithSubtitles } from "./media";
import type { NfoGenerator } from "./nfo";
import {
  downloadCrawlerAssets,
  organizePreparedVideo,
  prepareOutputCrawlerData,
  updateBatchProgress,
  writePreparedNfo,
} from "./output/executeOutputSteps";
import type { TranslateService } from "./TranslateService";
import { isAbortError, throwIfAborted } from "./utils/abort";
import { pathExists } from "./utils/filesystem";
import { classifyMovie, isLikelyUncensoredNumber } from "./utils/movieClassification";
import { parseFileInfo } from "./utils/number";

export interface RuntimeScrapeSignalService {
  showFailedInfo(input: { fileInfo: FileInfo; error: string }): void;
  showLogText(message: string): void;
  showScrapeInfo(input: {
    fileInfo: FileInfo;
    site: Website;
    step: "search" | "download" | "parse" | "organize";
  }): void;
  showScrapeResult(result: ScrapeResult): void;
  setProgress(value: number, current: number, total: number): void;
}

export interface FileScraperDependencies {
  actorImageService: RuntimeActorImageService;
  actorSourceProvider?: RuntimeActorSourceProvider;
  aggregationService: Pick<AggregationService, "aggregate"> & {
    getFailureSummary?(number: string): string | undefined;
  };
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  getConfiguration(): Promise<Configuration>;
  loadExistingNfoLocalState?(filePath: string, configuration: Configuration): Promise<NfoLocalState | undefined>;
  logger: { info(message: string): void; warn(message: string): void; error(message: string): void };
  nfoGenerator: NfoGenerator;
  postProcessAssets?(input: {
    assets: DownloadedAssets;
    configuration: Configuration;
    crawlerData: CrawlerData;
    fileInfo: FileInfo;
    localState?: NfoLocalState;
    signal?: AbortSignal;
  }): Promise<DownloadedAssets>;
  probeVideoMetadata?(sourcePath: string): Promise<VideoMeta | undefined>;
  signalService: RuntimeScrapeSignalService;
  translateService: Pick<TranslateService, "translateCrawlerData">;
}

export type ScrapeExecutionMode = "single" | "batch";

export interface FileScrapeProgress {
  fileIndex: number;
  totalFiles: number;
}

export type FileScrapeOptions = {
  manualScrape?: ManualScrapeOptions;
  scrapeSessionId?: string;
};

export interface CreateFileScraperOptions {
  mode?: ScrapeExecutionMode;
  scrapeSessionId?: string;
}

const AGGREGATION_FAILURE_CACHE_WINDOW_MS = 1000;

export class FileScraper {
  private readonly aggregationPromises = new Map<string, Promise<AggregationResult | null>>();
  private readonly numberExecutionChains = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: FileScraperDependencies,
    private readonly options: CreateFileScraperOptions = {},
  ) {}

  async scrapeFile(
    filePath: string,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
    options: FileScrapeOptions = {},
  ): Promise<ScrapeResult> {
    const configuration = await this.deps.getConfiguration();
    const parsedFileInfo = parseFileInfo(filePath, configuration.scrape.filenameIgnoreTokens);
    const fileId = buildFileId(parsedFileInfo.filePath);
    let fileInfo = parsedFileInfo;
    this.deps.signalService.showScrapeResult({ fileId, fileInfo, status: "processing" });
    this.setProgress(progress, 0);

    const lockKey = fileInfo.number.trim().toUpperCase();
    const previous = this.numberExecutionChains.get(lockKey) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => undefined).then(async () => await current);
    this.numberExecutionChains.set(lockKey, chain);
    await previous.catch(() => undefined);

    try {
      const resolved = await resolveFileInfoWithSubtitles(filePath, { parsedFileInfo });
      fileInfo = resolved.fileInfo;
      const videoMeta = await this.deps.probeVideoMetadata?.(fileInfo.filePath);
      this.setProgress(progress, 30);
      const existingNfoLocalState = await this.deps.loadExistingNfoLocalState?.(fileInfo.filePath, configuration);
      const scrapeSessionId = options.scrapeSessionId ?? this.options.scrapeSessionId;
      this.deps.signalService.showLogText(
        `Starting file scrape task ${randomUUID()} for ${fileInfo.fileName} (scrapeSessionId: ${scrapeSessionId ?? "standalone"})`,
      );
      throwIfAborted(signal);
      this.deps.signalService.showScrapeInfo({
        fileInfo,
        site: configuration.scrape.sites[0],
        step: "search",
      });

      const aggregationResult = await this.aggregate(fileInfo, configuration, signal, options.manualScrape);
      throwIfAborted(signal);
      if (!aggregationResult) {
        this.setProgress(progress, 100);
        fileInfo = await this.moveToFailedFolder(fileInfo, configuration);
        const error =
          this.deps.aggregationService.getFailureSummary?.(fileInfo.number) ?? "No crawler returned metadata";
        const result: ScrapeResult = { fileId, fileInfo, status: "failed", error };
        this.deps.signalService.showScrapeResult(result);
        this.deps.signalService.showFailedInfo({ fileInfo, error });
        return result;
      }

      let crawlerData: CrawlerData;
      try {
        crawlerData = await this.deps.translateService.translateCrawlerData(
          aggregationResult.data,
          configuration,
          signal,
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        this.deps.logger.warn(`Translation failed for ${aggregationResult.data.number}: ${toErrorMessage(error)}`);
        crawlerData = aggregationResult.data;
      }
      throwIfAborted(signal);
      crawlerData = canonicalizeCrawlerDataActorAliases(crawlerData, configuration);

      const plan = await this.deps.fileOrganizer.ensureOutputReady(
        {
          ...this.deps.fileOrganizer.plan(fileInfo, crawlerData, configuration, existingNfoLocalState, {
            executionMode: this.options.mode ?? "batch",
          }),
          subtitleSidecars: resolved.subtitleSidecars,
        },
        fileInfo.filePath,
      );
      throwIfAborted(signal);

      const prepared = await prepareOutputCrawlerData({
        actorImageService: this.deps.actorImageService,
        actorSourceProvider: this.deps.actorSourceProvider,
        config: configuration,
        crawlerData,
        enabled: true,
        movieDir: resolveMetadataOutputDir(plan),
        sourceVideoPath: fileInfo.filePath,
        signal,
      });
      crawlerData = prepared.data ?? crawlerData;
      throwIfAborted(signal);
      this.setProgress(progress, 50);

      this.deps.signalService.showScrapeInfo({ fileInfo, site: this.requireWebsite(crawlerData), step: "download" });
      const downloaded = await downloadCrawlerAssets({
        config: configuration,
        crawlerData,
        downloadManager: this.deps.downloadManager,
        fileInfo,
        imageAlternatives: aggregationResult.imageAlternatives,
        movieBaseName: path.basename(plan.nfoPath, ".nfo"),
        outputDir: resolveMetadataOutputDir(plan),
        sources: aggregationResult.sources,
        callbacks: { signal },
        onLog: (message) => this.deps.signalService.showLogText(message),
        postProcessAssets: this.deps.postProcessAssets
          ? async (assets, resolvedCrawlerData) =>
              (await this.deps.postProcessAssets?.({
                assets,
                configuration,
                crawlerData: resolvedCrawlerData,
                fileInfo,
                localState: existingNfoLocalState,
                signal,
              })) ?? assets
          : undefined,
      });
      crawlerData = downloaded.crawlerData;
      throwIfAborted(signal);
      this.setProgress(progress, 75);

      if (configuration.download.generateNfo) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] Generating NFO...`);
      }
      const savedNfoPath = await writePreparedNfo({
        assets: downloaded.assets,
        config: configuration,
        crawlerData,
        enabled: configuration.download.generateNfo,
        fileInfo,
        keepExisting: configuration.download.keepNfo,
        localState: existingNfoLocalState,
        nfoGenerator: this.deps.nfoGenerator,
        nfoPath: plan.nfoPath,
        sourceVideoPath: fileInfo.filePath,
        sources: aggregationResult.sources,
        videoMeta,
        probeVideoMetadata: this.deps.probeVideoMetadata,
      });
      throwIfAborted(signal);
      this.setProgress(progress, 80);

      this.deps.signalService.showScrapeInfo({ fileInfo, site: this.requireWebsite(crawlerData), step: "organize" });
      this.deps.signalService.showLogText(`[${fileInfo.number}] Organizing files...`);
      throwIfAborted(signal);
      const outputVideoPath = await organizePreparedVideo({
        config: configuration,
        enabled: true,
        fileInfo,
        fileOrganizer: this.deps.fileOrganizer,
        plan,
      });
      this.setProgress(progress, 100);
      const classification = classifyMovie(fileInfo, crawlerData, existingNfoLocalState);
      const result: ScrapeResult = {
        fileId,
        fileInfo: { ...fileInfo, filePath: outputVideoPath },
        status: "success",
        crawlerData,
        videoMeta,
        outputPath: plan.outputDir,
        nfoPath: savedNfoPath,
        assets: downloaded.assets,
        sources: aggregationResult.sources,
        uncensoredAmbiguous:
          classification.uncensored &&
          !classification.umr &&
          !classification.leak &&
          !isLikelyUncensoredNumber(crawlerData.number || fileInfo.number),
      };
      this.deps.signalService.showScrapeResult(result);
      return result;
    } catch (error) {
      this.setProgress(progress, 100);
      if (isAbortError(error)) {
        this.deps.logger.info(`Scrape aborted for ${fileInfo.filePath}`);
        const result: ScrapeResult = { fileId, fileInfo, status: "skipped", error: "Operation aborted" };
        this.deps.signalService.showScrapeResult(result);
        return result;
      }

      const message = toErrorMessage(error);
      this.deps.logger.error(`Scrape failed for ${fileInfo.filePath}: ${message}`);
      fileInfo = await this.moveToFailedFolder(fileInfo, configuration);
      const result: ScrapeResult = { fileId, fileInfo, status: "failed", error: message };
      this.deps.signalService.showScrapeResult(result);
      this.deps.signalService.showFailedInfo({ fileInfo, error: message });
      return result;
    } finally {
      release?.();
      if (this.numberExecutionChains.get(lockKey) === chain) this.numberExecutionChains.delete(lockKey);
    }
  }

  private async aggregate(
    fileInfo: FileInfo,
    configuration: Configuration,
    signal?: AbortSignal,
    manualScrape?: ManualScrapeOptions,
  ): Promise<AggregationResult | null> {
    if (isGeneratedSidecarVideo(fileInfo.filePath)) {
      return await this.deps.aggregationService.aggregate(fileInfo.number, configuration, signal, manualScrape);
    }

    const number = fileInfo.number.trim().toUpperCase();
    const key = manualScrape ? `${number}::${manualScrape.site}::${manualScrape.detailUrl ?? ""}` : number;
    const existing = this.aggregationPromises.get(key);
    if (existing) return await existing;

    const request = this.deps.aggregationService.aggregate(fileInfo.number, configuration, signal, manualScrape);
    this.aggregationPromises.set(key, request);
    try {
      return await request;
    } catch (error) {
      setTimeout(() => {
        if (this.aggregationPromises.get(key) === request) this.aggregationPromises.delete(key);
      }, AGGREGATION_FAILURE_CACHE_WINDOW_MS).unref?.();
      throw error;
    }
  }

  private async moveToFailedFolder(fileInfo: FileInfo, configuration: Configuration): Promise<FileInfo> {
    if (
      this.options.mode === "single" ||
      !configuration.behavior.failedFileMove ||
      !(await pathExists(fileInfo.filePath))
    ) {
      return fileInfo;
    }
    try {
      const movedPath = await this.deps.fileOrganizer.moveToFailedFolder(fileInfo, configuration);
      const moved = parseFileInfo(movedPath);
      return {
        ...fileInfo,
        ...moved,
        filePath: movedPath,
        isSubtitled: fileInfo.isSubtitled || moved.isSubtitled,
        subtitleTag: fileInfo.subtitleTag ?? moved.subtitleTag,
      };
    } catch (error) {
      this.deps.logger.warn(`Failed to move file to failed folder: ${toErrorMessage(error)}`);
      return fileInfo;
    }
  }

  private setProgress(progress: FileScrapeProgress, percent: number): void {
    updateBatchProgress(this.deps.signalService, progress, percent);
  }

  private requireWebsite(crawlerData: CrawlerData): Website {
    if (!crawlerData.website) throw new Error("Scrape crawler website not initialized");
    return crawlerData.website;
  }
}
