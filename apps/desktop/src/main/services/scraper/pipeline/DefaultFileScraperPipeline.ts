import { ActorImageService } from "@main/services/ActorImageService";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { LocalScanService } from "@main/services/scraper/maintenance/LocalScanService";
import { toErrorMessage } from "@main/utils/common";
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
  ScrapeContext,
  type ScrapeStage,
  TranslateStage,
} from "@mdcz/runtime/scrape";
import type { CrawlerData, NfoLocalState, ScrapeResult } from "@mdcz/shared/types";
import { isAbortError, throwIfAborted } from "../abort";
import type {
  FileScrapeOptions,
  FileScrapeProgress,
  FileScraperDependencies,
  ScrapeExecutionMode,
} from "../FileScraper";
import {
  applyResolvedSceneImageMetadata,
  downloadCrawlerAssets,
  organizePreparedVideo,
  prepareOutputCrawlerData,
  probeVideoMetadataOrWarn,
  writePreparedNfo,
} from "../output";
import { ScrapeFailureHandler } from "./ScrapeFailureHandler";

export class DefaultFileScraperPipeline implements FileScraperPipeline {
  private readonly logger = loggerService.getLogger("FileScraper");

  private readonly actorImageService: ActorImageService;

  private readonly localScanService: Pick<LocalScanService, "scanVideo">;

  private readonly aggregationCoordinator: AggregationCoordinator;

  private readonly numberExecutionGate = new NumberExecutionGate();

  private readonly failureHandler: ScrapeFailureHandler;

  readonly stages: readonly ScrapeStage[];

  constructor(
    private readonly deps: FileScraperDependencies,
    private readonly scrapeMode: ScrapeExecutionMode = "batch",
  ) {
    this.actorImageService = deps.actorImageService ?? new ActorImageService();
    this.localScanService = deps.localScanService ?? new LocalScanService();
    this.aggregationCoordinator = new AggregationCoordinator(deps.aggregationService);
    this.failureHandler = new ScrapeFailureHandler(deps.fileOrganizer, this.logger, deps.signalService);
    this.stages = this.createStages();
  }

  createContext(
    filePath: string,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    options: FileScrapeOptions = {},
  ): ScrapeContext {
    return new ScrapeContext(filePath, progress, this.scrapeMode, options.manualScrape);
  }

  setProgress(progress: FileScrapeProgress, stepPercent: number): void {
    this.failureHandler.setProgress(progress, stepPercent);
  }

  async runExclusiveByNumber<T>(number: string, operation: () => Promise<T>): Promise<T> {
    return await this.numberExecutionGate.runExclusive(number, operation);
  }

  async handleAbort(context: ScrapeContext): Promise<ScrapeResult> {
    return await this.failureHandler.handleAbort(context);
  }

  async handleError(context: ScrapeContext, error: unknown): Promise<ScrapeResult> {
    return await this.failureHandler.handleError(context, error);
  }

  private createStageRuntime(): FileScraperStageRuntime {
    return {
      actorImageService: this.actorImageService,
      actorSourceProvider: this.deps.actorSourceProvider,
      fileOrganizer: this.deps.fileOrganizer,
      logger: this.logger,
      nfoGenerator: this.deps.nfoGenerator,
      signalService: {
        showFailedInfo: (input) => this.deps.signalService.showFailedInfo(input),
        showLogText: (message) => this.deps.signalService.showLogText(message),
        showScrapeInfo: (input) => this.deps.signalService.showScrapeInfo(input),
        showScrapeResult: (result) => this.deps.signalService.showScrapeResult(result),
        setProgress: (value, current, total) => this.deps.signalService.setProgress(value, current, total),
      },
      getConfiguration: async () => await configManager.getValidated(),
      aggregateMetadata: async (fileInfo, configuration, signal, manualScrape) =>
        await this.aggregationCoordinator.aggregate(fileInfo, configuration, signal, manualScrape),
      handleFailedFileMove: async (fileInfo, configuration) =>
        await this.failureHandler.moveToFailedFolder(fileInfo, configuration, this.scrapeMode),
      loadExistingNfoLocalState: async (filePath, configuration) =>
        await this.loadExistingNfoLocalState(filePath, configuration),
      setProgress: (progress, stepPercent) => {
        this.setProgress(progress, stepPercent);
      },
      translateCrawlerData: async (crawlerData, configuration, signal) =>
        await this.translateCrawlerDataOrFallback(crawlerData, configuration, signal),
      probeVideoMetadata: async (context) =>
        await probeVideoMetadataOrWarn({
          logger: this.logger,
          sourceVideoPath: context.fileInfo.filePath,
          warningPrefix: "Video probe failed",
        }),
      prepareOutputCrawlerData: async (context, signal) => {
        const prepared = await prepareOutputCrawlerData({
          actorImageService: this.actorImageService,
          actorSourceProvider: this.deps.actorSourceProvider,
          config: context.requireConfiguration(),
          crawlerData: context.requireCrawlerData(),
          enabled: true,
          movieDir: context.requirePlan().outputDir,
          sourceVideoPath: context.fileInfo.filePath,
          signal,
        });
        return {
          data: prepared.data ?? context.requireCrawlerData(),
          actorPhotoPaths: prepared.actorPhotoPaths,
        };
      },
      downloadCrawlerAssets: async (context, signal) => {
        const aggregationResult = context.requireAggregationResult();
        const crawlerData = context.requireCrawlerData();
        const plan = context.requirePlan();
        let resolvedSceneImageUrls: string[] | undefined;
        const assets = await downloadCrawlerAssets({
          config: context.requireConfiguration(),
          crawlerData,
          downloadManager: this.deps.downloadManager,
          fileInfo: context.fileInfo,
          imageAlternatives: aggregationResult.imageAlternatives,
          localState: context.existingNfoLocalState,
          logger: this.logger,
          movieBaseName: plan.nfoPath
            .split(/[\\/]/u)
            .pop()
            ?.replace(/\.nfo$/iu, ""),
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
        return {
          assets,
          crawlerData: applyResolvedSceneImageMetadata(crawlerData, resolvedSceneImageUrls),
        };
      },
      writePreparedNfo: async (context) =>
        await writePreparedNfo({
          assets: context.assets ?? {
            downloaded: [],
            sceneImages: [],
          },
          config: context.requireConfiguration(),
          crawlerData: context.requireCrawlerData(),
          enabled: context.requireConfiguration().download.generateNfo,
          fileInfo: context.fileInfo,
          keepExisting: context.requireConfiguration().download.keepNfo,
          localState: context.existingNfoLocalState,
          logger: this.logger,
          nfoGenerator: this.deps.nfoGenerator,
          nfoPath: context.requirePlan().nfoPath,
          sourceVideoPath: context.fileInfo.filePath,
          sources: context.requireAggregationResult().sources,
          videoMeta: context.videoMeta,
        }),
      organizePreparedVideo: async (context) =>
        await organizePreparedVideo({
          config: context.requireConfiguration(),
          enabled: true,
          fileInfo: context.fileInfo,
          fileOrganizer: this.deps.fileOrganizer,
          plan: context.requirePlan(),
        }),
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

  private async translateCrawlerDataOrFallback(
    crawlerData: CrawlerData,
    configuration: Awaited<ReturnType<FileScraperStageRuntime["getConfiguration"]>>,
    signal?: AbortSignal,
  ): Promise<CrawlerData> {
    throwIfAborted(signal);

    try {
      return await this.deps.translateService.translateCrawlerData(crawlerData, configuration, signal);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const message = toErrorMessage(error);
      this.logger.warn(`Translation failed for ${crawlerData.number}: ${message}`);
      return crawlerData;
    }
  }

  private async loadExistingNfoLocalState(
    filePath: string,
    configuration: Awaited<ReturnType<FileScraperStageRuntime["getConfiguration"]>>,
  ): Promise<NfoLocalState | undefined> {
    if (!configuration.download.generateNfo || !configuration.download.keepNfo) {
      return undefined;
    }

    try {
      const entry = await this.localScanService.scanVideo(filePath, configuration.paths.sceneImagesFolder);
      return entry.nfoLocalState;
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to read existing NFO local state for ${filePath}: ${message}`);
      return undefined;
    }
  }
}
