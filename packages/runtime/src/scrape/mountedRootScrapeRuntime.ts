import { stat } from "node:fs/promises";
import path from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, DownloadedAssets, FileInfo, NfoLocalState, ScrapeResult } from "@mdcz/shared/types";
import { NetworkClient, type RuntimeDownloadNetworkClient } from "../network";
import { ActorImageService } from "./ActorImageService";
import type { RuntimeActorSourceProvider } from "./actorOutput";
import type { AggregationResult, ManualScrapeOptions } from "./aggregation";
import { DownloadManager, type ImageHostCooldownStore, MemoryImageHostCooldownStore } from "./download";
import { FileOrganizer, resolveMetadataOutputDir } from "./FileOrganizer";
import { FileScraper } from "./FileScraper";
import { NfoGenerator, nfoIgnoreFieldsToEnabledFields, reconcileExistingNfoFiles } from "./nfo";
import { prepareCrawlerDataForMovieOutput } from "./output/prepareCrawlerDataForMovieOutput";
import { prepareImageAlternativesForDownload } from "./output/prepareImageAlternativesForDownload";
import {
  AggregateStage,
  AggregationCoordinator,
  CanonicalizeActorAliasesStage,
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
import type { TranslationMappingStore } from "./translate/types";
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
  getFailureSummary?(number: string): string | undefined;
}

export interface MountedRootScrapeRuntimeItemInput {
  root: MediaRoot;
  relativePath: string;
  manualScrape?: NonNullable<Parameters<FileScraper["scrapeFile"]>[3]>["manualScrape"];
  localState?: NfoLocalState;
  progress: { fileIndex: number; totalFiles: number };
  onEvent?: (type: string, message: string) => Promise<void> | void;
  onProgress?: (progress: { value: number; current: number; total: number }) => Promise<void> | void;
  onStage?: (stage: "search" | "download" | "parse" | "organize", message: string) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface MountedRootScrapeRuntimeItemSuccess {
  status: "success";
  result: ScrapeResult;
  crawlerData: CrawlerData;
  nfoPath: string | null;
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

class MountedRootScrapeSignalService implements RuntimeScrapeSignalService {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly emit: (type: string, message: string) => Promise<void> | void,
    private readonly emitProgress: (progress: {
      value: number;
      current: number;
      total: number;
    }) => Promise<void> | void,
    private readonly emitStage: (
      stage: "search" | "download" | "parse" | "organize",
      message: string,
    ) => Promise<void> | void,
  ) {}

  showFailedInfo(_input: { fileInfo: FileInfo; error: string }): void {}

  showLogText(message: string): void {
    this.track(this.emit("log", message));
  }

  showScrapeInfo(input: {
    fileInfo: FileInfo;
    site: CrawlerData["website"];
    step: "search" | "download" | "parse" | "organize";
  }): void {
    this.track(this.emitStage(input.step, `${input.fileInfo.fileName}${input.fileInfo.extension}: ${input.site}`));
  }

  showScrapeResult(_result: ScrapeResult): void {}

  setProgress(value: number, current: number, total: number): void {
    this.track(this.emitProgress({ value, current, total }));
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  private track(result: Promise<void> | void): void {
    if (!result) {
      return;
    }

    this.pending.add(result);
    result.then(
      () => this.pending.delete(result),
      () => this.pending.delete(result),
    );
  }
}

class MountedRootFileScraperPipeline implements FileScraperPipeline {
  private readonly nfoGenerator = new NfoGenerator();
  private readonly networkClient: RuntimeDownloadNetworkClient;
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
    networkClient?: RuntimeDownloadNetworkClient,
    private readonly localState?: NfoLocalState,
    mappingStore?: TranslationMappingStore,
    imageHostCooldownStore: ImageHostCooldownStore = new MemoryImageHostCooldownStore(),
    private readonly actorSourceProvider?: RuntimeActorSourceProvider,
  ) {
    this.networkClient = networkClient ?? new NetworkClient();
    const runtimeLogger = toRuntimeLogger(this.logger);
    this.fileOrganizer = new FileOrganizer(runtimeLogger);
    this.translateService = new TranslateService(this.networkClient, { logger: runtimeLogger, mappingStore });
    this.downloadManager = new DownloadManager(this.networkClient, {
      imageHostCooldownStore,
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

  async createContext(
    filePath: string,
    progress: { fileIndex: number; totalFiles: number } = { fileIndex: 1, totalFiles: 1 },
    options: Parameters<FileScraperPipeline["createContext"]>[2] = {},
  ): Promise<ScrapeContext> {
    const configuration = await this.getConfiguration();
    return new ScrapeContext(filePath, progress, "batch", options.manualScrape, configuration);
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
      actorSourceProvider: this.actorSourceProvider,
      fileOrganizer: this.fileOrganizer,
      logger: this.logger,
      nfoGenerator: this.nfoGenerator,
      signalService: this.signalService,
      getConfiguration: async () => await this.getConfiguration(),
      aggregateMetadata: async (fileInfo, configuration, signal, manualScrape) =>
        await this.aggregationCoordinator.aggregate(fileInfo, configuration, signal, manualScrape),
      getAggregationFailureMessage: (fileInfo) => this.aggregationService.getFailureSummary?.(fileInfo.number),
      handleFailedFileMove: async (fileInfo, configuration) => await this.moveToFailedFolder(fileInfo, configuration),
      loadExistingNfoLocalState: async () => this.localState,
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
            movieDir: resolveMetadataOutputDir(context.requirePlan()),
            sourceVideoPath: context.fileInfo.filePath,
            actorSourceProvider: this.actorSourceProvider,
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
      new CanonicalizeActorAliasesStage(),
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
      resolveMetadataOutputDir(context.requirePlan()),
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
      enabledFields: nfoIgnoreFieldsToEnabledFields(configuration.download.nfoIgnoreFields),
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
    private readonly networkClient?: RuntimeDownloadNetworkClient,
    private readonly mappingStore?: TranslationMappingStore,
    private readonly imageHostCooldownStore?: ImageHostCooldownStore,
    private readonly actorSourceProvider?: RuntimeActorSourceProvider,
  ) {}

  async scrape(input: MountedRootScrapeRuntimeItemInput): Promise<MountedRootScrapeRuntimeItemResult> {
    const signalService = new MountedRootScrapeSignalService(
      (type, message) => {
        console.info(message);
        return input.onEvent?.(type, message);
      },
      (progress) => input.onProgress?.(progress),
      (stage, message) => input.onStage?.(stage, message),
    );
    try {
      const scraper = new FileScraper(
        new MountedRootFileScraperPipeline(
          input.root,
          this.config,
          this.aggregationService,
          signalService,
          this.logger,
          this.networkClient,
          input.localState,
          this.mappingStore,
          this.imageHostCooldownStore,
          this.actorSourceProvider,
        ),
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
        nfoPath: result.nfoPath ?? null,
        outputRelativePath: toRootRelativePath(input.root, outputVideoPath),
        size: stats?.size ?? 0,
        modifiedAt: stats?.mtime ?? null,
      };
    } finally {
      await signalService.flush();
    }
  }
}
