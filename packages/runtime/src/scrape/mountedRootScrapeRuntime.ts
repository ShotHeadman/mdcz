import { stat } from "node:fs/promises";
import path from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, DownloadedAssets, FileInfo, ScrapeResult } from "@mdcz/shared/types";
import type { MediaRoot } from "@mdcz/storage";
import { resolveRootRelativePath, toRootRelativePath } from "@mdcz/storage";
import { FetchNetworkClient } from "../network";
import { ActorImageService } from "./ActorImageService";
import type { AggregationResult, ManualScrapeOptions } from "./aggregation";
import { DownloadManager } from "./download";
import { FileOrganizer } from "./FileOrganizer";
import { FileScraper } from "./FileScraper";
import { NfoGenerator, reconcileExistingNfoFiles } from "./nfo";
import { prepareCrawlerDataForMovieOutput } from "./output/prepareCrawlerDataForMovieOutput";
import { prepareImageAlternativesForDownload } from "./output/prepareImageAlternativesForDownload";
import {
  AggregateStage,
  AggregationCoordinator,
  DownloadStage,
  type FileScraperPipeline,
  type FileScraperStageRuntime,
  NfoStage,
  NumberExecutionGate,
  OrganizeStage,
  ParseStage,
  PlanStage,
  PrepareOutputStage,
  ProbeStage,
  type RuntimeScrapeSignalService,
  ScrapeContext,
  type ScrapeStage,
  TranslateStage,
} from "./pipeline";
import { TranslateService } from "./TranslateService";
import { isAbortError } from "./utils/abort";
import { pathExists } from "./utils/filesystem";
import { parseFileInfo } from "./utils/number";

interface MountedRootScrapeLogger {
  debug?(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const toRuntimeLogger = (logger: MountedRootScrapeLogger) => ({
  debug: (message: string) => logger.debug?.(message),
  info: (message: string) => logger.info(message),
  warn: (message: string) => logger.warn(message),
  error: (message: string) => logger.error(message),
});

export interface MountedRootScrapeRuntimeConfig {
  runtimePaths: {
    dataDir: string;
  };
  get(): Promise<Configuration>;
}

export interface MountedRootScrapeAggregationService {
  aggregate(
    number: string,
    configuration: Configuration,
    signal?: AbortSignal,
    manualScrape?: ManualScrapeOptions,
  ): Promise<AggregationResult | null>;
}

export interface MountedRootScrapeRuntimeItemInput {
  root: MediaRoot;
  relativePath: string;
  manualScrape?: NonNullable<Parameters<FileScraper["scrapeFile"]>[3]>["manualScrape"];
  progress: { fileIndex: number; totalFiles: number };
  onEvent?: (type: string, message: string) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface MountedRootScrapeRuntimeItemSuccess {
  status: "success";
  result: ScrapeResult;
  crawlerData: CrawlerData;
  nfoRelativePath: string | null;
  outputRelativePath: string;
  size: number;
  modifiedAt: Date | null;
}

export interface MountedRootScrapeRuntimeItemFailure {
  status: "failed" | "skipped";
  result: ScrapeResult;
  error: string;
}

export type MountedRootScrapeRuntimeItemResult =
  | MountedRootScrapeRuntimeItemSuccess
  | MountedRootScrapeRuntimeItemFailure;

class MemoryImageHostCooldownStore {
  private readonly entries = new Map<string, { failures: number[]; cooldownUntil?: number }>();

  getActiveCooldown(key: string): { cooldownUntil: number; remainingMs: number } | null {
    const entry = this.entries.get(key);
    const cooldownUntil = entry?.cooldownUntil;
    if (!cooldownUntil) {
      return null;
    }
    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs <= 0) {
      this.reset(key);
      return null;
    }
    return { cooldownUntil, remainingMs };
  }

  isCoolingDown(key: string): boolean {
    return this.getActiveCooldown(key) !== null;
  }

  recordFailure(
    key: string,
    policy: { threshold: number; windowMs: number; cooldownMs: number },
  ): { cooldownUntil?: number | null; failureCount: number } | null {
    const now = Date.now();
    const entry = this.entries.get(key) ?? { failures: [] };
    const failures = [...entry.failures.filter((timestamp) => now - timestamp <= policy.windowMs), now];
    const cooldownUntil = failures.length >= policy.threshold ? now + policy.cooldownMs : entry.cooldownUntil;
    this.entries.set(key, { failures, cooldownUntil });
    return { cooldownUntil, failureCount: failures.length };
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

class MountedRootScrapeSignalService implements RuntimeScrapeSignalService {
  constructor(private readonly emit: (type: string, message: string) => Promise<void> | void) {}

  showFailedInfo(input: { fileInfo: FileInfo; error: string }): void {
    void this.emit("item-failed", `${input.fileInfo.fileName}${input.fileInfo.extension}: ${input.error}`);
  }

  showLogText(message: string): void {
    void this.emit("log", message);
  }

  showScrapeInfo(input: {
    fileInfo: FileInfo;
    site: CrawlerData["website"];
    step: "search" | "download" | "parse" | "organize";
  }): void {
    void this.emit(input.step, `${input.fileInfo.fileName}${input.fileInfo.extension}: ${input.site}`);
  }

  showScrapeResult(result: ScrapeResult): void {
    void this.emit(result.status, `${result.fileInfo.fileName}${result.fileInfo.extension}: ${result.status}`);
  }

  setProgress(value: number, current: number, total: number): void {
    void this.emit("progress", `刮削进度 ${current}/${total} (${value}%)`);
  }
}

class MountedRootFileScraperPipeline implements FileScraperPipeline {
  private readonly nfoGenerator = new NfoGenerator();
  private readonly networkClient = new FetchNetworkClient();
  private readonly fileOrganizer: FileOrganizer;
  private readonly translateService: TranslateService;
  private readonly downloadManager: DownloadManager;
  private readonly actorImageService: ActorImageService;
  private readonly aggregationCoordinator: AggregationCoordinator;
  private readonly numberExecutionGate = new NumberExecutionGate();

  readonly stages: readonly ScrapeStage[];

  constructor(
    private readonly root: MediaRoot,
    private readonly config: MountedRootScrapeRuntimeConfig,
    private readonly aggregationService: MountedRootScrapeAggregationService,
    private readonly signalService: RuntimeScrapeSignalService,
    private readonly logger: MountedRootScrapeLogger,
  ) {
    const runtimeLogger = toRuntimeLogger(this.logger);
    this.fileOrganizer = new FileOrganizer(runtimeLogger);
    this.translateService = new TranslateService(this.networkClient, { logger: runtimeLogger });
    this.downloadManager = new DownloadManager(this.networkClient, {
      imageHostCooldownStore: new MemoryImageHostCooldownStore(),
      logger: runtimeLogger,
    });
    this.actorImageService = new ActorImageService({
      cacheRoot: path.join(this.config.runtimePaths.dataDir, "actor-image-cache"),
      logger: runtimeLogger,
      networkClient: this.networkClient,
    });
    this.aggregationCoordinator = new AggregationCoordinator(this.aggregationService);
    this.stages = this.createStages();
  }

  createContext(
    filePath: string,
    progress: { fileIndex: number; totalFiles: number } = { fileIndex: 1, totalFiles: 1 },
    options: Parameters<FileScraperPipeline["createContext"]>[2] = {},
  ): ScrapeContext {
    return new ScrapeContext(filePath, progress, "batch", options.manualScrape);
  }

  setProgress(progress: { fileIndex: number; totalFiles: number }, stepPercent: number): void {
    const normalizedPercent = Math.max(0, Math.min(100, stepPercent));
    const fileIndex = Math.max(1, progress.fileIndex);
    const totalFiles = Math.max(1, progress.totalFiles);
    const globalValue = (fileIndex - 1 + normalizedPercent / 100) / totalFiles;
    const value = Math.max(0, Math.min(100, Math.round(globalValue * 100)));
    this.signalService.setProgress(value, fileIndex, totalFiles);
  }

  async runExclusiveByNumber<T>(number: string, operation: () => Promise<T>): Promise<T> {
    return await this.numberExecutionGate.runExclusive(number, operation);
  }

  async handleAbort(context: ScrapeContext): Promise<ScrapeResult> {
    this.logger.info(`Scrape aborted for ${context.fileInfo.filePath}`);
    this.setProgress(context.progress, 100);
    const skippedResult: ScrapeResult = {
      fileId: context.fileId,
      fileInfo: context.fileInfo,
      status: "skipped",
      error: "Operation aborted",
    };
    this.signalService.showScrapeResult(skippedResult);
    return skippedResult;
  }

  async handleError(context: ScrapeContext, error: unknown): Promise<ScrapeResult> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Scrape failed for ${context.fileInfo.filePath}: ${message}`);
    this.setProgress(context.progress, 100);

    try {
      context.fileInfo = await this.moveToFailedFolder(context.fileInfo, await this.getConfiguration());
    } catch (moveError) {
      const moveMessage = moveError instanceof Error ? moveError.message : String(moveError);
      this.logger.warn(`Failed to move file to failed folder: ${moveMessage}`);
    }

    const failedResult: ScrapeResult = {
      fileId: context.fileId,
      fileInfo: context.fileInfo,
      status: "failed",
      error: message,
    };
    this.signalService.showScrapeResult(failedResult);
    this.signalService.showFailedInfo({ fileInfo: context.fileInfo, error: message });
    return failedResult;
  }

  private createStageRuntime(): FileScraperStageRuntime {
    return {
      actorImageService: this.actorImageService,
      fileOrganizer: this.fileOrganizer,
      logger: this.logger,
      nfoGenerator: this.nfoGenerator,
      signalService: this.signalService,
      getConfiguration: async () => await this.getConfiguration(),
      aggregateMetadata: async (fileInfo, configuration, signal, manualScrape) =>
        await this.aggregationCoordinator.aggregate(fileInfo, configuration, signal, manualScrape),
      handleFailedFileMove: async (fileInfo, configuration) => await this.moveToFailedFolder(fileInfo, configuration),
      loadExistingNfoLocalState: async () => undefined,
      setProgress: (progress, stepPercent) => {
        this.setProgress(progress, stepPercent);
      },
      translateCrawlerData: async (crawlerData, configuration, signal) => {
        try {
          return await this.translateService.translateCrawlerData(crawlerData, configuration, signal);
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          this.logger.warn(
            `Translation failed for ${crawlerData.number}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return crawlerData;
        }
      },
      probeVideoMetadata: async () => undefined,
      prepareOutputCrawlerData: async (context, signal) => {
        const prepared = await prepareCrawlerDataForMovieOutput(
          this.actorImageService,
          context.requireConfiguration(),
          context.requireCrawlerData(),
          {
            enabled: true,
            movieDir: context.requirePlan().outputDir,
            sourceVideoPath: context.fileInfo.filePath,
            signal,
          },
        );
        return {
          data: prepared.data,
          actorPhotoPaths: prepared.actorPhotoPaths,
        };
      },
      downloadCrawlerAssets: async (context, signal) => await this.downloadCrawlerAssets(context, signal),
      writePreparedNfo: async (context) => await this.writePreparedNfo(context),
      organizePreparedVideo: async (context) =>
        await this.fileOrganizer.organizeVideo(context.fileInfo, context.requirePlan(), context.requireConfiguration()),
    };
  }

  private createStages(): readonly ScrapeStage[] {
    const runtime = this.createStageRuntime();
    return [
      new ParseStage(),
      new ProbeStage(runtime),
      new AggregateStage(runtime),
      new TranslateStage(runtime),
      new PlanStage(runtime),
      new PrepareOutputStage(runtime),
      new DownloadStage(runtime),
      new NfoStage(runtime),
      new OrganizeStage(runtime),
    ];
  }

  private async getConfiguration(): Promise<Configuration> {
    const configuration = await this.config.get();
    return {
      ...configuration,
      paths: {
        ...configuration.paths,
        mediaPath: this.root.hostPath,
      },
    };
  }

  private async moveToFailedFolder(fileInfo: FileInfo, config: Configuration): Promise<FileInfo> {
    if (!config.behavior.failedFileMove || !(await pathExists(fileInfo.filePath))) {
      return fileInfo;
    }
    try {
      const movedPath = await this.fileOrganizer.moveToFailedFolder(fileInfo, config);
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

  private async downloadCrawlerAssets(
    context: ScrapeContext,
    signal?: AbortSignal,
  ): Promise<{ assets: DownloadedAssets; crawlerData?: CrawlerData }> {
    this.signalService.showLogText(`[${context.fileInfo.number}] Downloading resources...`);
    const aggregationResult = context.requireAggregationResult();
    const crawlerData = context.requireCrawlerData();
    const preparedImageAlternatives = prepareImageAlternativesForDownload(
      crawlerData,
      aggregationResult.imageAlternatives,
      aggregationResult.sources,
    );
    let resolvedSceneImageUrls: string[] | undefined;
    const assets = await this.downloadManager.downloadAll(
      context.requirePlan().outputDir,
      crawlerData,
      context.requireConfiguration(),
      preparedImageAlternatives,
      {
        onResolvedSceneImageUrls: (urls) => {
          resolvedSceneImageUrls = urls;
        },
        onSceneProgress: (downloaded, total) => {
          this.signalService.showLogText(`[${context.fileInfo.number}] Scene images: ${downloaded}/${total}`);
        },
        signal,
      },
      {
        movieBaseName: path.basename(context.requirePlan().nfoPath, ".nfo"),
      },
    );

    return {
      assets,
      crawlerData:
        resolvedSceneImageUrls === undefined ? crawlerData : { ...crawlerData, scene_images: resolvedSceneImageUrls },
    };
  }

  private async writePreparedNfo(context: ScrapeContext): Promise<string | undefined> {
    const configuration = context.requireConfiguration();
    if (!(configuration.download.generateNfo && context.plan)) {
      return undefined;
    }
    const assets = context.assets ?? { downloaded: [], sceneImages: [] };
    if (configuration.download.keepNfo) {
      const existingNfoPath = await reconcileExistingNfoFiles(
        context.plan.nfoPath,
        configuration.download.nfoNaming,
        pathExists,
      );
      if (existingNfoPath) {
        return existingNfoPath;
      }
    }
    return await this.nfoGenerator.writeNfo(context.plan.nfoPath, context.requireCrawlerData(), {
      assets,
      fileInfo: context.fileInfo,
      localState: context.existingNfoLocalState,
      nfoNaming: configuration.download.nfoNaming,
      nfoTitleTemplate: configuration.naming.nfoTitleTemplate,
      sources: context.requireAggregationResult().sources,
      videoMeta: context.videoMeta,
    });
  }
}

export class MountedRootScrapeRuntime {
  constructor(
    private readonly config: MountedRootScrapeRuntimeConfig,
    private readonly aggregationService: MountedRootScrapeAggregationService,
    private readonly logger: MountedRootScrapeLogger = console,
  ) {}

  async scrape(input: MountedRootScrapeRuntimeItemInput): Promise<MountedRootScrapeRuntimeItemResult> {
    const signalService = new MountedRootScrapeSignalService((type, message) => {
      void input.onEvent?.(type, message);
      this.logger.info(`[${type}] ${message}`);
    });
    const scraper = new FileScraper(
      new MountedRootFileScraperPipeline(input.root, this.config, this.aggregationService, signalService, this.logger),
    );
    const absolutePath = resolveRootRelativePath(input.root, input.relativePath);
    const result = await scraper.scrapeFile(absolutePath, input.progress, input.signal, {
      manualScrape: input.manualScrape,
    });

    if (result.status !== "success" || !result.crawlerData) {
      return {
        status: result.status === "skipped" ? "skipped" : "failed",
        result,
        error: result.error ?? "刮削失败",
      };
    }

    const outputVideoPath = result.fileInfo.filePath;
    const stats = await stat(outputVideoPath).catch(() => null);
    return {
      status: "success",
      result,
      crawlerData: result.crawlerData,
      nfoRelativePath: result.nfoPath ? toRootRelativePath(input.root, result.nfoPath) : null,
      outputRelativePath: toRootRelativePath(input.root, outputVideoPath),
      size: stats?.size ?? 0,
      modifiedAt: stats?.mtime ?? null,
    };
  }
}
