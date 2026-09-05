import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
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
import type { PreparedPublicationPlan } from "../publication";
import {
  type AggregationService,
  type DownloadManager,
  downloadCrawlerAssets,
  type FileOrganizer,
  type NfoGenerator,
  organizePreparedVideo,
  prepareOutputCrawlerData,
  type TranslateService,
  updateBatchProgress,
  writePreparedNfo,
} from "../scrape";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "../scrape/actorOutput";
import { isAbortError, throwIfAborted } from "../scrape/utils/abort";
import { pathExists } from "../scrape/utils/filesystem";
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
}

export type MaintenanceFileScrapeResult = MaintenanceItemResult & { publicationPlan?: PreparedPublicationPlan };

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
  ): Promise<MaintenanceFileScrapeResult> {
    const { fileInfo } = entry;
    this.logger.info(`[${this.preset.id}] Processing ${fileInfo.number} (${fileInfo.fileName})`);
    this.setProgress(progress, 0);

    let stagingDir: string | undefined;
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
      stagingDir = await mkdtemp(join(tmpdir(), "mdcz-maintenance-publication-"));
      const metadataOutputDir = plan?.metadataDir ?? plan?.outputDir ?? entry.currentDir;
      const preparedOutputData = await prepareOutputCrawlerData({
        actorImageService: this.actorImageService,
        actorSourceProvider: this.deps.actorSourceProvider,
        config,
        crawlerData,
        enabled: Boolean(plan && (this.preset.steps.generateNfo || this.preset.steps.download)),
        movieDir: stagingDir,
        sourceVideoPath: fileInfo.filePath,
        signal,
      });
      throwIfAborted(signal);
      let preparedCrawlerData = preparedOutputData.data;
      const preparedActorPhotoPaths = preparedOutputData.actorPhotoPaths;
      const downloaded = await this.downloadPreparedAssets(
        entry,
        config,
        stagingDir,
        preparedCrawlerData,
        imageAlternatives,
        aggregationSources,
        committed,
        signal,
      );
      const toTargetPath = (stagedPath: string): string => {
        const relativePath = relative(stagingDir as string, stagedPath);
        if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return stagedPath;
        return join(metadataOutputDir, relativePath);
      };
      const downloadedAssets = downloaded.assets ?? { sceneImages: [], downloaded: [] };
      const assets: DownloadedAssets = {
        ...downloadedAssets,
        thumb: downloadedAssets.thumb ? toTargetPath(downloadedAssets.thumb) : undefined,
        poster: downloadedAssets.poster ? toTargetPath(downloadedAssets.poster) : undefined,
        fanart: downloadedAssets.fanart ? toTargetPath(downloadedAssets.fanart) : undefined,
        sceneImages: (downloadedAssets.sceneImages ?? []).map(toTargetPath),
        trailer: downloadedAssets.trailer ? toTargetPath(downloadedAssets.trailer) : undefined,
        downloaded: (downloadedAssets.downloaded ?? []).map(toTargetPath),
      };
      preparedCrawlerData = downloaded.crawlerData;

      throwIfAborted(signal);
      this.setProgress(progress, 75);

      const nfoArtifacts = new Map<string, string>();
      const savedNfoPath = await writePreparedNfo({
        assets,
        config,
        crawlerData: preparedCrawlerData,
        enabled: Boolean(this.preset.steps.generateNfo && plan),
        fileInfo,
        localState: entry.nfoLocalState,
        buildTags: buildMovieTags,
        nfoGenerator: this.deps.nfoGenerator,
        nfoPath: plan?.nfoPath,
        onLog: (message) => this.deps.signalService.showLogText(message),
        sourceVideoPath: fileInfo.filePath,
        sources: aggregationSources,
        startLogLabel: `[${fileInfo.number}] Generating NFO...`,
        writeFile: async (targetPath, content) => {
          nfoArtifacts.set(targetPath, content);
        },
      });

      throwIfAborted(signal);
      this.setProgress(progress, 80);

      const outputVideoPath = await organizePreparedVideo({
        enabled: this.preset.steps.organize,
        fileInfo,
        plan,
        onLog: (message) => this.deps.signalService.showLogText(message),
        startLogLabel: `[${fileInfo.number}] Organizing files...`,
      });

      throwIfAborted(signal);
      const updatedEntry = this.buildUpdatedEntry(entry, preparedCrawlerData, {
        fileInfo: { ...fileInfo, filePath: outputVideoPath },
        currentDir: plan?.outputDir ?? dirname(outputVideoPath),
        nfoPath: savedNfoPath,
        assets: {
          thumb: assets.thumb,
          poster: assets.poster,
          fanart: assets.fanart,
          sceneImages: assets.sceneImages,
          trailer: assets.trailer,
          actorPhotos: preparedActorPhotoPaths.map(toTargetPath),
        },
      });

      const sourceStats = await stat(fileInfo.filePath);
      const stagedArtifactPaths = Array.from(
        new Set([...(downloadedAssets.downloaded ?? []), ...preparedActorPhotoPaths]),
      );
      const artifacts: PreparedPublicationPlan["artifacts"] = await Promise.all(
        stagedArtifactPaths.map(async (stagedPath) => ({
          targetPath: toTargetPath(stagedPath),
          content: { kind: "bytes" as const, data: await readFile(stagedPath) },
        })),
      );
      artifacts.push(
        ...[...nfoArtifacts].map(([targetPath, data]) => ({
          targetPath,
          content: { kind: "text" as const, data },
        })),
      );
      this.setProgress(progress, 100);
      const obsoletePaths: string[] = [];
      if (entry.assets.trailer && !assets.trailer) obsoletePaths.push(entry.assets.trailer);
      if (entry.nfoPath && plan?.nfoPath && entry.nfoPath !== plan.nfoPath) obsoletePaths.push(entry.nfoPath);
      if (plan?.nfoPath && !nfoArtifacts.has(plan.nfoPath) && entry.nfoPath && (await pathExists(entry.nfoPath))) {
        artifacts.push({
          targetPath: plan.nfoPath,
          content: { kind: "bytes", data: await readFile(entry.nfoPath) },
        });
      }

      return {
        fileId: entry.fileId,
        status: "success",
        crawlerData: preparedCrawlerData,
        updatedEntry,
        fieldDiffs,
        unchangedFieldDiffs,
        pathDiff,
        publicationPlan: {
          video: { sourcePath: fileInfo.filePath, targetPath: outputVideoPath, size: sourceStats.size },
          artifacts,
          assets: [
            ...(assets.thumb ? [{ kind: "thumb", targetPath: assets.thumb }] : []),
            ...(assets.poster ? [{ kind: "poster", targetPath: assets.poster }] : []),
            ...(assets.fanart ? [{ kind: "fanart", targetPath: assets.fanart }] : []),
            ...(assets.trailer ? [{ kind: "trailer", targetPath: assets.trailer }] : []),
            ...assets.sceneImages.map((targetPath) => ({ kind: "scene", targetPath })),
          ],
          obsoletePaths,
          replaceExistingTargetPaths: [outputVideoPath, ...artifacts.map((artifact) => artifact.targetPath)],
        },
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
    } finally {
      if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
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

  private setProgress(progress: MaintenanceProgressState, stepPercent: number): void {
    updateBatchProgress(this.deps.signalService, progress, stepPercent);
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
