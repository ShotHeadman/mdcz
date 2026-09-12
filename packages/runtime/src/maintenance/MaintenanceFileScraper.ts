import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type {
  CrawlerData,
  DiscoveredAssets,
  DownloadedAssets,
  LocalScanEntry,
  MaintenanceImageAlternatives,
  MaintenanceItemResult,
  MaintenancePreviewItem,
} from "@mdcz/shared/types";
import { type PreparedPublicationPlan, preparePublicationPlan } from "../publication";
import {
  type AggregationService,
  type DownloadManager,
  downloadCrawlerAssets,
  type FileOrganizer,
  type NfoGenerator,
  prepareOutputCrawlerData,
  reportItemProgress,
  type TranslateService,
  writePreparedNfo,
} from "../scrape";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "../scrape/actorOutput";
import type { FileScraperDependencies } from "../scrape/FileScraper";
import { getNfoWritePaths } from "../scrape/nfo";
import { isAbortError, throwIfAborted } from "../scrape/utils/abort";
import { runtimeLoggerService } from "../shared";
import {
  type CommittedMaintenanceFile,
  MaintenancePreparationService,
  type PreparedMaintenanceFile,
} from "./MaintenancePreparationService";
import { buildMovieTags } from "./movieTags";
import type { MaintenancePreset } from "./presets";

export interface MaintenanceSignalService {
  setProgress(value: number, current: number, total: number): void;
  showLogText(message: string): void;
}

type MaintenanceProgressState = {
  fileIndex: number;
  totalFiles: number;
};

export interface MaintenanceFileScraperDependencies {
  actorImageService?: RuntimeActorImageService;
  actorSourceProvider?: RuntimeActorSourceProvider;
  aggregationService: AggregationService;
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  nfoGenerator: NfoGenerator;
  signalService: MaintenanceSignalService;
  translateService: TranslateService;
  postProcessAssets?: FileScraperDependencies["postProcessAssets"];
}

export type MaintenanceFileScrapeResult = MaintenanceItemResult & {
  publicationPlan?: PreparedPublicationPlan;
  release?: () => Promise<void>;
};

export class MaintenanceFileScraper {
  private readonly logger = runtimeLoggerService.getLogger("MaintenanceFileScraper");

  private readonly actorImageService: RuntimeActorImageService;

  private readonly preparationService: MaintenancePreparationService;

  constructor(
    private readonly deps: MaintenanceFileScraperDependencies,
    private readonly preset: MaintenancePreset,
  ) {
    this.actorImageService = deps.actorImageService ?? {
      prepareActorProfilesForMovie: async () => undefined,
    };
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
    progress: MaintenanceProgressState = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
    committed?: CommittedMaintenanceFile,
    sharedOutput?: LocalScanEntry,
  ): Promise<MaintenanceFileScrapeResult> {
    const { fileInfo } = entry;
    this.logger.info(`[${this.preset.id}] Processing ${fileInfo.number} (${fileInfo.fileName})`);
    this.setProgress(progress, 0);

    let stagingDir: string | undefined;
    let stagingHandedOff = false;
    try {
      throwIfAborted(signal);
      const prepared = committed
        ? await this.preparationService.prepareCommittedFile(entry, config, committed, {
            createDirectories: false,
            onProgress: (stepPercent) => this.setProgress(progress, stepPercent),
          })
        : await this.preparationService.prepareFile(entry, config, {
            createDirectories: false,
            emitLogs: true,
            onProgress: (stepPercent) => this.setProgress(progress, stepPercent),
            signal,
          });
      const { crawlerData, fieldDiffs, unchangedFieldDiffs, aggregationSources, imageAlternatives, plan, pathDiff } =
        prepared;
      const sharedMetadata =
        plan && sharedOutput?.nfoPath === getNfoWritePaths(plan.nfoPath, config.download.nfoNaming).canonicalPath
          ? sharedOutput
          : undefined;
      stagingDir = await mkdtemp(join(tmpdir(), "mdcz-maintenance-publication-"));
      const metadataOutputDir = plan?.metadataDir ?? plan?.outputDir ?? entry.currentDir;
      const preparedOutputData = await prepareOutputCrawlerData({
        actorImageService: this.actorImageService,
        actorSourceProvider: this.deps.actorSourceProvider,
        config,
        crawlerData,
        enabled: Boolean(!sharedMetadata && plan && (this.preset.steps.generateNfo || this.preset.steps.download)),
        movieDir: stagingDir,
        sourceVideoPath: fileInfo.filePath,
        signal,
      });
      throwIfAborted(signal);
      let preparedCrawlerData = preparedOutputData.data;
      const preparedActorPhotoPaths = preparedOutputData.actorPhotoPaths;
      const downloaded = sharedMetadata
        ? { assets: { ...sharedMetadata.assets, downloaded: [] }, crawlerData: sharedMetadata.crawlerData }
        : await this.downloadPreparedAssets(
            entry,
            config,
            stagingDir,
            preparedCrawlerData,
            imageAlternatives,
            aggregationSources,
            committed,
            plan?.nfoPath ? basename(plan.nfoPath, ".nfo") : fileInfo.fileName,
            signal,
          );
      preparedCrawlerData = downloaded.crawlerData;
      throwIfAborted(signal);
      const outputVideoPath = this.preset.steps.organize && plan ? plan.targetVideoPath : fileInfo.filePath;
      const publication = await preparePublicationPlan({
        sourceVideoPath: fileInfo.filePath,
        outputVideoPath,
        stagingDir,
        existingAssetDir: entry.nfoPath ? dirname(entry.nfoPath) : entry.currentDir,
        metadataOutputDir,
        downloadedAssets: downloaded.assets,
        actorPhotoPaths: preparedActorPhotoPaths,
        existingAssets: entry.assets,
        existingNfoPath: entry.nfoPath,
        assetDecisions: committed?.assetDecisions,
        organizePlan: plan,
        organizeFiles: this.preset.steps.organize,
        renameSubtitles: config.behavior.successFileRename,
        nfoNaming: config.download.nfoNaming,
        assetNamingMode: config.naming.assetNamingMode,
        strmPathMappings: config.paths.strmPathMappings,
        reuseNfo: Boolean(sharedMetadata),
        writeNfo: async (assets, writeFile) =>
          await writePreparedNfo({
            assets,
            config,
            crawlerData: preparedCrawlerData,
            enabled: Boolean(!sharedMetadata && this.preset.steps.generateNfo && plan),
            fileInfo,
            localState: entry.nfoLocalState,
            buildTags: buildMovieTags,
            nfoGenerator: this.deps.nfoGenerator,
            nfoPath: plan?.nfoPath,
            sourceVideoPath: fileInfo.filePath,
            sources: aggregationSources,
            writeFile,
          }),
      });
      if (sharedMetadata) {
        const sharedPaths = new Set([
          sharedMetadata.nfoPath,
          sharedMetadata.assets.thumb,
          sharedMetadata.assets.poster,
          sharedMetadata.assets.fanart,
          sharedMetadata.assets.trailer,
          ...sharedMetadata.assets.sceneImages,
          ...sharedMetadata.assets.actorPhotos,
        ]);
        publication.plan.media?.push({
          sourcePath: sharedMetadata.fileInfo.filePath,
          targetPath: sharedMetadata.fileInfo.filePath,
          size: (await stat(sharedMetadata.fileInfo.filePath)).size,
          assets: publication.plan.assets.filter((asset) => asset.targetPath && sharedPaths.has(asset.targetPath)),
        });
      }
      throwIfAborted(signal);
      const updatedEntry = this.buildUpdatedEntry(entry, preparedCrawlerData, {
        fileInfo: { ...fileInfo, filePath: outputVideoPath },
        currentDir: plan?.outputDir ?? dirname(outputVideoPath),
        nfoPath: publication.nfoPath,
        strmPath: publication.plan.assets.find((asset) => asset.kind === "strm")?.targetPath ?? entry.strmPath,
        assets: publication.assets,
      });
      this.setProgress(progress, 100);
      const result: MaintenanceFileScrapeResult = {
        fileId: entry.fileId,
        status: "success",
        crawlerData: preparedCrawlerData,
        updatedEntry,
        fieldDiffs,
        unchangedFieldDiffs,
        pathDiff,
        publicationPlan: publication.plan,
        release: async () => {
          await rm(stagingDir as string, { recursive: true, force: true });
        },
      };
      stagingHandedOff = true;
      return result;
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
    } finally {
      if (stagingDir && !stagingHandedOff) await rm(stagingDir, { recursive: true, force: true });
    }
  }

  async previewFile(
    entry: LocalScanEntry,
    config: Configuration,
    signal?: AbortSignal,
    sharedData?: CommittedMaintenanceFile,
  ): Promise<MaintenancePreviewItem> {
    try {
      const prepared = sharedData
        ? await this.preparationService.prepareCommittedFile(entry, config, sharedData, { createDirectories: false })
        : await this.preparationService.prepareFile(entry, config, {
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
      strmPath?: string;
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

  private setProgress(progress: MaintenanceProgressState, stepPercent: number): void {
    reportItemProgress(this.deps.signalService, progress, stepPercent);
  }

  private async downloadPreparedAssets(
    entry: LocalScanEntry,
    config: Configuration,
    outputDir: string | undefined,
    preparedCrawlerData: CrawlerData | undefined,
    imageAlternatives: MaintenanceImageAlternatives,
    aggregationSources: PreparedMaintenanceFile["aggregationSources"],
    committed: CommittedMaintenanceFile | undefined,
    movieBaseName: string,
    signal?: AbortSignal,
  ): Promise<{ assets: DownloadedAssets; crawlerData?: CrawlerData }> {
    const assets: DownloadedAssets = {
      thumb: entry.assets.thumb,
      poster: entry.assets.poster,
      fanart: entry.assets.fanart,
      sceneImages: entry.assets.sceneImages,
      trailer: entry.assets.trailer,
      downloaded: [],
    };

    if (!(this.preset.steps.download && outputDir && preparedCrawlerData)) {
      return { assets, crawlerData: preparedCrawlerData };
    }

    const { fileInfo } = entry;
    const forceReplace = this.getForcedPrimaryImageRefresh(entry, preparedCrawlerData);
    const postProcessAssets = this.deps.postProcessAssets;
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
      outputDir,
      movieBaseName,
      existingAssets: entry.assets,
      existingAssetDir: entry.nfoPath ? dirname(entry.nfoPath) : entry.currentDir,
      postProcessAssets: postProcessAssets
        ? async (assets, crawlerData) =>
            await postProcessAssets({
              assets,
              crawlerData,
              configuration: config,
              fileInfo,
              localState: entry.nfoLocalState,
              signal,
            })
        : undefined,
      onLog: (message) => this.deps.signalService.showLogText(message),
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
