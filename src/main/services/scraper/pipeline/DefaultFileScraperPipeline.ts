import { ActorImageService } from "@main/services/ActorImageService";
import { configurationSchema } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { LocalScanService } from "@main/services/scraper/maintenance/LocalScanService";
import type { CrawlerData, NfoLocalState, ScrapeResult } from "@shared/types";
import { isAbortError, throwIfAborted } from "../abort";
import type { FileScrapeProgress, FileScraperDependencies } from "../FileScraper";
import { AggregateStage } from "./AggregateStage";
import { AggregationCoordinator } from "./AggregationCoordinator";
import { DownloadStage } from "./DownloadStage";
import { NfoStage } from "./NfoStage";
import { NumberExecutionGate } from "./NumberExecutionGate";
import { OrganizeStage } from "./OrganizeStage";
import { ParseStage } from "./ParseStage";
import { PlanStage } from "./PlanStage";
import { PrepareOutputStage } from "./PrepareOutputStage";
import { ProbeStage } from "./ProbeStage";
import { ScrapeContext } from "./ScrapeContext";
import { ScrapeFailureHandler } from "./ScrapeFailureHandler";
import { TranslateStage } from "./TranslateStage";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export interface FileScraperPipeline {
  readonly stages: readonly ScrapeStage[];

  createContext(filePath: string, progress?: FileScrapeProgress): ScrapeContext;

  setProgress(progress: FileScrapeProgress, stepPercent: number): void;

  runExclusiveByNumber<T>(number: string, operation: () => Promise<T>): Promise<T>;

  handleAbort(context: ScrapeContext): Promise<ScrapeResult>;

  handleError(context: ScrapeContext, error: unknown): Promise<ScrapeResult>;
}

export class DefaultFileScraperPipeline implements FileScraperPipeline {
  private readonly logger = loggerService.getLogger("FileScraper");

  private readonly actorImageService: ActorImageService;

  private readonly localScanService: Pick<LocalScanService, "scanVideo">;

  private readonly aggregationCoordinator: AggregationCoordinator;

  private readonly numberExecutionGate = new NumberExecutionGate();

  private readonly failureHandler: ScrapeFailureHandler;

  readonly stages: readonly ScrapeStage[];

  constructor(private readonly deps: FileScraperDependencies) {
    this.actorImageService = deps.actorImageService ?? new ActorImageService();
    this.localScanService = deps.localScanService ?? new LocalScanService();
    this.aggregationCoordinator = new AggregationCoordinator(deps.aggregationService);
    this.failureHandler = new ScrapeFailureHandler(
      deps.configManager,
      deps.fileOrganizer,
      this.logger,
      deps.signalService,
    );
    this.stages = this.createStages();
  }

  createContext(filePath: string, progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 }): ScrapeContext {
    return new ScrapeContext(filePath, progress);
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
      downloadManager: this.deps.downloadManager,
      fileOrganizer: this.deps.fileOrganizer,
      logger: this.logger,
      nfoGenerator: this.deps.nfoGenerator,
      signalService: this.deps.signalService,
      getConfiguration: async () => configurationSchema.parse(await this.deps.configManager.get()),
      aggregateMetadata: async (fileInfo, configuration, signal) =>
        await this.aggregationCoordinator.aggregate(fileInfo, configuration, signal),
      handleFailedFileMove: async (fileInfo, configuration) =>
        await this.failureHandler.moveToFailedFolder(fileInfo, configuration),
      loadExistingNfoLocalState: async (filePath, configuration) =>
        await this.loadExistingNfoLocalState(filePath, configuration),
      setProgress: (progress, stepPercent) => {
        this.setProgress(progress, stepPercent);
      },
      translateCrawlerData: async (crawlerData, configuration, signal) =>
        await this.translateCrawlerDataOrFallback(crawlerData, configuration, signal),
    };
  }

  private createStages(): readonly ScrapeStage[] {
    const runtime = this.createStageRuntime();
    return [
      new ParseStage(),
      new AggregateStage(runtime),
      new ProbeStage(runtime),
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

      const message = error instanceof Error ? error.message : String(error);
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
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to read existing NFO local state for ${filePath}: ${message}`);
      return undefined;
    }
  }
}
