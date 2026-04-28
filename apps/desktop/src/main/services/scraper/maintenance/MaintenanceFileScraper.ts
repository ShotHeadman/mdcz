import { dirname } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import type { Configuration } from "@main/services/config/models";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import type {
  CrawlerData,
  DiscoveredAssets,
  DownloadedAssets,
  LocalScanEntry,
  MaintenanceImageAlternatives,
  MaintenanceItemResult,
  MaintenancePreviewItem,
} from "@mdcz/shared/types";
import { isAbortError, throwIfAborted } from "../abort";
import type { FileScrapeProgress, FileScraperDependencies } from "../FileScraper";
import {
  downloadCrawlerAssets,
  organizePreparedVideo,
  prepareOutputCrawlerData,
  updateScrapeProgress,
  writePreparedNfo,
} from "../output";
import { MaintenanceArtifactResolver } from "./MaintenanceArtifactResolver";
import {
  type CommittedMaintenanceFile,
  MaintenancePreparationService,
  type PreparedMaintenanceFile,
} from "./MaintenancePreparationService";
import type { MaintenancePreset } from "./presets";

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
  ): Promise<MaintenanceItemResult> {
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
      const preparedOutputData = await prepareOutputCrawlerData({
        actorImageService: this.actorImageService,
        actorSourceProvider: this.deps.actorSourceProvider,
        config,
        crawlerData,
        enabled: Boolean(plan && (this.preset.steps.generateNfo || this.preset.steps.download)),
        movieDir: plan?.outputDir,
        sourceVideoPath: fileInfo.filePath,
        signal,
      });
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

      const savedNfoPath = await writePreparedNfo({
        assets,
        config,
        crawlerData: preparedCrawlerData,
        enabled: Boolean(this.preset.steps.generateNfo && plan),
        fileInfo,
        localState: entry.nfoLocalState,
        logger: this.logger,
        nfoGenerator: this.deps.nfoGenerator,
        nfoPath: plan?.nfoPath,
        signalService: this.deps.signalService,
        sourceVideoPath: fileInfo.filePath,
        sources: aggregationSources,
        startLogLabel: `[${fileInfo.number}] Generating NFO...`,
      });

      throwIfAborted(signal);
      this.setProgress(progress, 80);

      const outputVideoPath = await organizePreparedVideo({
        config,
        enabled: this.preset.steps.organize,
        fileInfo,
        fileOrganizer: this.deps.fileOrganizer,
        plan,
        signalService: this.deps.signalService,
        startLogLabel: `[${fileInfo.number}] Organizing files...`,
      });

      throwIfAborted(signal);
      const resolvedArtifacts = await this.artifactResolver.resolve({
        entry,
        plan,
        outputVideoPath,
        preferredAssets: assets,
        savedNfoPath,
        preparedActorPhotoPaths,
        assetDecisions: committed?.assetDecisions,
        nfoNaming: config.download.nfoNaming,
      });
      const updatedEntry = this.buildUpdatedEntry(entry, preparedCrawlerData, {
        fileInfo: { ...fileInfo, filePath: outputVideoPath },
        currentDir: plan?.outputDir ?? dirname(outputVideoPath),
        nfoPath: resolvedArtifacts.nfoPath,
        assets: resolvedArtifacts.assets,
      });

      this.setProgress(progress, 100);

      return {
        fileId: entry.fileId,
        status: "success",
        crawlerData: preparedCrawlerData,
        updatedEntry,
        fieldDiffs,
        unchangedFieldDiffs,
        pathDiff,
      };
    } catch (error) {
      if (isAbortError(error)) {
        this.logger.info(`Maintenance aborted for ${fileInfo.filePath}`);
        this.setProgress(progress, 100);
        return this.buildFailedResult(entry, "Operation aborted");
      }

      const message = toErrorMessage(error);
      this.logger.error(`Maintenance failed for ${fileInfo.filePath}: ${message}`);
      this.setProgress(progress, 100);
      return this.buildFailedResult(entry, message);
    }
  }

  async previewFile(
    entry: LocalScanEntry,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<MaintenancePreviewItem> {
    try {
      const prepared = await this.preparationService.prepareFile(entry, config, {
        createDirectories: false,
        emitLogs: false,
        signal,
      });

      return {
        fileId: entry.fileId,
        status: "ready",
        fieldDiffs: prepared.fieldDiffs,
        unchangedFieldDiffs: prepared.unchangedFieldDiffs,
        pathDiff: prepared.pathDiff,
        proposedCrawlerData: prepared.crawlerData,
        imageAlternatives: prepared.imageAlternatives,
      };
    } catch (error) {
      return {
        fileId: entry.fileId,
        status: "blocked",
        error: toErrorMessage(error),
      };
    }
  }

  private buildFailedResult(entry: LocalScanEntry, error: string): MaintenanceItemResult {
    return {
      fileId: entry.fileId,
      status: "failed",
      error,
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
      fileInfo: updates.fileInfo,
      nfoPath: updates.nfoPath,
      crawlerData: crawlerData ?? entry.crawlerData,
      nfoLocalState: entry.nfoLocalState,
      scanError: undefined,
      assets: updates.assets,
      currentDir: updates.currentDir,
      groupingDirectory: entry.groupingDirectory ?? entry.currentDir,
    };
  }

  private setProgress(progress: FileScrapeProgress, stepPercent: number): void {
    updateScrapeProgress(this.deps.signalService, progress, stepPercent);
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
    const forceReplace = this.getForcedPrimaryImageRefresh(entry, preparedCrawlerData);
    return await downloadCrawlerAssets({
      callbacks: {
        forceReplace,
        assetDecisions: committed?.assetDecisions,
        signal,
      },
      config,
      crawlerData: preparedCrawlerData,
      downloadManager: this.deps.downloadManager,
      fileInfo,
      imageAlternatives,
      localState: entry.nfoLocalState,
      logger: this.logger,
      outputDir,
      signalService: this.deps.signalService,
      sources: aggregationSources,
    });
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
