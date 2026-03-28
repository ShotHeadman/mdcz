import { dirname } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import type { Configuration } from "@main/services/config/models";
import { loggerService } from "@main/services/LoggerService";
import { probeVideoMetadata } from "@main/utils/video";
import type {
  CrawlerData,
  DiscoveredAssets,
  DownloadedAssets,
  FieldDiff,
  LocalScanEntry,
  MaintenanceImageAlternatives,
  PathDiff,
  ScrapeResult,
  VideoMeta,
} from "@shared/types";
import { isAbortError, throwIfAborted } from "../abort";
import type { FileScrapeProgress, FileScraperDependencies } from "../FileScraper";
import { prepareCrawlerDataForMovieOutput } from "../prepareCrawlerDataForMovieOutput";
import { prepareImageAlternativesForDownload } from "../prepareImageAlternativesForDownload";
import { MaintenanceArtifactResolver } from "./MaintenanceArtifactResolver";
import {
  type CommittedMaintenanceFile,
  MaintenancePreparationService,
  type PreparedMaintenanceFile,
} from "./MaintenancePreparationService";
import type { MaintenancePreset } from "./presets";

export interface MaintenanceProcessResult {
  scrapeResult: ScrapeResult;
  updatedEntry?: LocalScanEntry;
  fieldDiffs?: FieldDiff[];
  unchangedFieldDiffs?: FieldDiff[];
  pathDiff?: PathDiff;
}

export interface MaintenancePreviewFileResult {
  entryId: string;
  status: "ready" | "blocked";
  error?: string;
  fieldDiffs?: FieldDiff[];
  unchangedFieldDiffs?: FieldDiff[];
  pathDiff?: PathDiff;
  proposedCrawlerData?: CrawlerData;
  imageAlternatives?: MaintenanceImageAlternatives;
}

export class MaintenanceFileScraper {
  private readonly logger = loggerService.getLogger("MaintenanceFileScraper");

  private readonly actorImageService: ActorImageService;

  private readonly preparationService: MaintenancePreparationService;

  private readonly artifactResolver = new MaintenanceArtifactResolver();

  constructor(
    private readonly deps: FileScraperDependencies,
    private readonly preset: MaintenancePreset,
  ) {
    this.actorImageService = deps.actorImageService ?? new ActorImageService();
    this.preparationService = new MaintenancePreparationService(
      {
        aggregationService: deps.aggregationService,
        translateService: deps.translateService,
        fileOrganizer: deps.fileOrganizer,
        signalService: deps.signalService,
      },
      preset,
    );
  }

  async processFile(
    entry: LocalScanEntry,
    config: Configuration,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
    committed?: CommittedMaintenanceFile,
  ): Promise<MaintenanceProcessResult> {
    const { fileInfo } = entry;
    this.logger.info(`[${this.preset.id}] Processing ${fileInfo.number} (${fileInfo.fileName})`);
    this.setProgress(progress, 0);

    try {
      throwIfAborted(signal);
      const prepared = committed
        ? await this.preparationService.prepareCommittedFile(entry, config, committed, {
            createDirectories: true,
            onProgress: (stepPercent) => this.setProgress(progress, stepPercent),
          })
        : await this.preparationService.prepareFile(entry, config, {
            createDirectories: true,
            emitLogs: true,
            onProgress: (stepPercent) => this.setProgress(progress, stepPercent),
            signal,
          });
      const { crawlerData, fieldDiffs, unchangedFieldDiffs, aggregationSources, imageAlternatives, plan, pathDiff } =
        prepared;
      const preparedOutputData = await this.prepareOutputCrawlerData(
        fileInfo.filePath,
        config,
        crawlerData,
        plan,
        signal,
      );
      throwIfAborted(signal);
      const preparedCrawlerData = preparedOutputData.data;
      const preparedActorPhotoPaths = preparedOutputData.actorPhotoPaths;
      const assets = await this.downloadPreparedAssets(
        entry,
        config,
        plan?.outputDir,
        preparedCrawlerData,
        imageAlternatives,
        aggregationSources,
        committed,
        signal,
      );

      throwIfAborted(signal);
      this.setProgress(progress, 75);

      const savedNfoPath = await this.generatePreparedNfo(
        fileInfo.filePath,
        fileInfo.number,
        entry,
        fileInfo,
        plan,
        preparedCrawlerData,
        assets,
        aggregationSources,
        config,
      );

      throwIfAborted(signal);
      this.setProgress(progress, 80);

      const outputVideoPath = await this.organizePreparedVideo(fileInfo, plan, config);

      throwIfAborted(signal);
      const resolvedArtifacts = await this.artifactResolver.resolve({
        entry,
        plan,
        outputVideoPath,
        assets,
        savedNfoPath,
        preparedActorPhotoPaths,
        assetDecisions: committed?.assetDecisions,
        nfoNaming: config.download.nfoNaming,
      });
      const resolvedAssets = this.artifactResolver.toDownloadedAssets(assets, resolvedArtifacts.assets);
      const updatedEntry = this.buildUpdatedEntry(entry, preparedCrawlerData, {
        fileInfo: { ...fileInfo, filePath: outputVideoPath },
        currentDir: plan?.outputDir ?? dirname(outputVideoPath),
        nfoPath: resolvedArtifacts.nfoPath,
        assets: resolvedArtifacts.assets,
      });

      this.setProgress(progress, 100);

      const result: ScrapeResult = {
        fileInfo: { ...fileInfo, filePath: outputVideoPath },
        status: "success",
        crawlerData: preparedCrawlerData,
        outputPath: plan?.outputDir,
        nfoPath: resolvedArtifacts.nfoPath,
        assets: resolvedAssets,
      };

      return { scrapeResult: result, updatedEntry, fieldDiffs, unchangedFieldDiffs, pathDiff };
    } catch (error) {
      if (isAbortError(error)) {
        this.logger.info(`Maintenance aborted for ${fileInfo.filePath}`);
        this.setProgress(progress, 100);
        return this.buildFailedResult(entry, "Operation aborted");
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Maintenance failed for ${fileInfo.filePath}: ${message}`);
      this.setProgress(progress, 100);
      return this.buildFailedResult(entry, message);
    }
  }

  async previewFile(
    entry: LocalScanEntry,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<MaintenancePreviewFileResult> {
    try {
      const prepared = await this.preparationService.prepareFile(entry, config, {
        createDirectories: false,
        emitLogs: false,
        signal,
      });

      return {
        entryId: entry.id,
        status: "ready",
        fieldDiffs: prepared.fieldDiffs,
        unchangedFieldDiffs: prepared.unchangedFieldDiffs,
        pathDiff: prepared.pathDiff,
        proposedCrawlerData: prepared.crawlerData,
        imageAlternatives: prepared.imageAlternatives,
      };
    } catch (error) {
      return {
        entryId: entry.id,
        status: "blocked",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildFailedResult(entry: LocalScanEntry, error: string): MaintenanceProcessResult {
    return {
      scrapeResult: {
        fileInfo: entry.fileInfo,
        status: "failed",
        error,
      },
    };
  }

  private buildUpdatedEntry(
    entry: LocalScanEntry,
    crawlerData: CrawlerData | undefined,
    updates: {
      fileInfo: LocalScanEntry["fileInfo"];
      currentDir: string;
      nfoPath?: string;
      assets: DiscoveredAssets;
    },
  ): LocalScanEntry {
    return {
      ...entry,
      videoPath: updates.fileInfo.filePath,
      fileInfo: updates.fileInfo,
      nfoPath: updates.nfoPath,
      crawlerData: crawlerData ?? entry.crawlerData,
      nfoLocalState: entry.nfoLocalState,
      scanError: undefined,
      assets: updates.assets,
      currentDir: updates.currentDir,
    };
  }

  private setProgress(progress: FileScrapeProgress, stepPercent: number): void {
    const normalizedPercent = Math.max(0, Math.min(100, stepPercent));
    const fileIndex = Math.max(1, progress.fileIndex);
    const totalFiles = Math.max(1, progress.totalFiles);
    const globalValue = (fileIndex - 1 + normalizedPercent / 100) / totalFiles;
    const value = Math.max(0, Math.min(100, Math.round(globalValue * 100)));

    this.deps.signalService.setProgress(value, fileIndex, totalFiles);
  }

  private async prepareOutputCrawlerData(
    sourceVideoPath: string,
    config: Configuration,
    crawlerData: CrawlerData | undefined,
    plan: PreparedMaintenanceFile["plan"],
    signal?: AbortSignal,
  ): Promise<{ data: CrawlerData | undefined; actorPhotoPaths: string[] }> {
    if (!crawlerData) {
      return {
        data: crawlerData,
        actorPhotoPaths: [],
      };
    }

    return await prepareCrawlerDataForMovieOutput(this.actorImageService, config, crawlerData, {
      enabled: Boolean(plan && (this.preset.steps.generateNfo || this.preset.steps.download)),
      movieDir: plan?.outputDir,
      sourceVideoPath,
      actorSourceProvider: this.deps.actorSourceProvider,
      signal,
    });
  }

  private async downloadPreparedAssets(
    entry: LocalScanEntry,
    config: Configuration,
    outputDir: string | undefined,
    preparedCrawlerData: CrawlerData | undefined,
    imageAlternatives: MaintenanceImageAlternatives,
    aggregationSources: PreparedMaintenanceFile["aggregationSources"],
    committed: CommittedMaintenanceFile | undefined,
    signal?: AbortSignal,
  ): Promise<DownloadedAssets> {
    const assets: DownloadedAssets = {
      thumb: entry.assets.thumb,
      poster: entry.assets.poster,
      fanart: entry.assets.fanart,
      sceneImages: entry.assets.sceneImages,
      trailer: entry.assets.trailer,
      downloaded: [],
    };

    if (!(this.preset.steps.download && outputDir && preparedCrawlerData)) {
      return assets;
    }

    const { fileInfo } = entry;
    this.deps.signalService.showLogText(`[${fileInfo.number}] Downloading resources...`);
    const forceReplace = this.getForcedPrimaryImageRefresh(entry, preparedCrawlerData);
    const downloadImageAlternatives = prepareImageAlternativesForDownload(
      preparedCrawlerData,
      imageAlternatives,
      aggregationSources,
    );

    return await this.deps.downloadManager.downloadAll(
      outputDir,
      preparedCrawlerData,
      config,
      downloadImageAlternatives,
      {
        onSceneProgress: (downloaded, total) => {
          this.deps.signalService.showLogText(`[${fileInfo.number}] Scene images: ${downloaded}/${total}`);
        },
        forceReplace,
        assetDecisions: committed?.assetDecisions,
        signal,
      },
    );
  }

  private async generatePreparedNfo(
    sourceVideoPath: string,
    number: string,
    entry: LocalScanEntry,
    fileInfo: LocalScanEntry["fileInfo"],
    plan: PreparedMaintenanceFile["plan"],
    preparedCrawlerData: CrawlerData | undefined,
    assets: DownloadedAssets,
    aggregationSources: PreparedMaintenanceFile["aggregationSources"],
    config: Configuration,
  ): Promise<string | undefined> {
    if (!(this.preset.steps.generateNfo && plan && preparedCrawlerData)) {
      return undefined;
    }

    this.deps.signalService.showLogText(`[${number}] Generating NFO...`);
    let videoMeta: VideoMeta | undefined;
    try {
      videoMeta = await probeVideoMetadata(sourceVideoPath);
    } catch {
      this.logger.warn(`Video probe failed for ${sourceVideoPath}`);
    }

    return await this.deps.nfoGenerator.writeNfo(plan.nfoPath, preparedCrawlerData, {
      assets,
      sources: aggregationSources,
      videoMeta,
      fileInfo,
      localState: entry.nfoLocalState,
      nfoNaming: config.download.nfoNaming,
      nfoTitleTemplate: config.naming.nfoTitleTemplate,
    });
  }

  private async organizePreparedVideo(
    fileInfo: LocalScanEntry["fileInfo"],
    plan: PreparedMaintenanceFile["plan"],
    config: Configuration,
  ): Promise<string> {
    if (!(this.preset.steps.organize && plan)) {
      return fileInfo.filePath;
    }

    this.deps.signalService.showLogText(`[${fileInfo.number}] Organizing files...`);
    return await this.deps.fileOrganizer.organizeVideo(fileInfo, plan, config);
  }

  private getForcedPrimaryImageRefresh(
    entry: LocalScanEntry,
    crawlerData: CrawlerData,
  ): Partial<Record<"thumb" | "poster" | "fanart", boolean>> {
    const forceReplace: Partial<Record<"thumb" | "poster" | "fanart", boolean>> = {};
    const mappings = [
      {
        field: "thumb_url" as const,
        sourceField: "thumb_source_url" as const,
        key: "thumb" as const,
      },
      {
        field: "poster_url" as const,
        sourceField: "poster_source_url" as const,
        key: "poster" as const,
      },
    ];

    for (const { field, sourceField, key } of mappings) {
      const nextValue = this.normalizeComparableUrl(crawlerData[sourceField] ?? crawlerData[field]);
      const currentValue = this.normalizeComparableUrl(entry.crawlerData?.[sourceField] ?? entry.crawlerData?.[field]);
      if (nextValue && nextValue !== currentValue) {
        forceReplace[key] = true;
      }
    }

    if (forceReplace.thumb) {
      forceReplace.fanart = true;
    }

    return forceReplace;
  }

  private normalizeComparableUrl(value: string | undefined): string {
    const normalized = value?.trim() ?? "";
    return /^https?:\/\//iu.test(normalized) ? normalized : "";
  }
}
