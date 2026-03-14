import { copyFile, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import type { Configuration } from "@main/services/config/models";
import { loggerService } from "@main/services/LoggerService";
import { moveFileSafely, pathExists } from "@main/utils/file";
import { probeVideoMetadata } from "@main/utils/video";
import type {
  CrawlerData,
  DiscoveredAssets,
  DownloadedAssets,
  FieldDiff,
  LocalScanEntry,
  MaintenanceAssetDecisions,
  MaintenanceImageAlternatives,
  PathDiff,
  ScrapeResult,
  VideoMeta,
} from "@shared/types";
import type { SourceMap } from "../aggregation/types";
import type { OrganizePlan } from "../FileOrganizer";
import type { FileScrapeProgress, FileScraperDependencies } from "../FileScraper";
import { prepareCrawlerDataForNfo } from "../prepareCrawlerDataForNfo";
import { partitionCrawlerDataWithOptions } from "./diffCrawlerData";
import { diffPaths } from "./diffPaths";
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

interface PreparedMaintenanceFile {
  crawlerData?: CrawlerData;
  fieldDiffs?: FieldDiff[];
  unchangedFieldDiffs?: FieldDiff[];
  aggregationSources?: SourceMap;
  imageAlternatives: MaintenanceImageAlternatives;
  plan?: OrganizePlan;
  pathDiff?: PathDiff;
}

interface CommittedMaintenanceFile {
  crawlerData?: CrawlerData;
  imageAlternatives?: MaintenanceImageAlternatives;
  assetDecisions?: MaintenanceAssetDecisions;
}

interface ResolvedMaintenanceArtifacts {
  nfoPath?: string;
  assets: DiscoveredAssets;
}

export class MaintenanceFileScraper {
  private readonly logger = loggerService.getLogger("MaintenanceFileScraper");

  private readonly actorImageService: ActorImageService;

  constructor(
    private readonly deps: FileScraperDependencies,
    private readonly preset: MaintenancePreset,
  ) {
    this.actorImageService = deps.actorImageService ?? new ActorImageService();
  }

  async processFile(
    entry: LocalScanEntry,
    config: Configuration,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
    committed?: CommittedMaintenanceFile,
  ): Promise<MaintenanceProcessResult> {
    const { fileInfo } = entry;
    const { steps } = this.preset;
    this.logger.info(`[${this.preset.id}] Processing ${fileInfo.number} (${fileInfo.fileName})`);
    this.setProgress(progress, 0);

    try {
      const prepared = committed
        ? await this.prepareCommittedFile(entry, config, committed, {
            createDirectories: true,
            progress,
          })
        : await this.prepareFile(entry, config, signal, {
            createDirectories: true,
            progress,
            emitLogs: true,
          });
      const { crawlerData, fieldDiffs, unchangedFieldDiffs, aggregationSources, imageAlternatives, plan, pathDiff } =
        prepared;
      let preparedCrawlerData = crawlerData;
      let preparedActorPhotoPaths: string[] = [];

      // Step 4: Download assets (if enabled)
      let assets: DownloadedAssets = {
        thumb: entry.assets.thumb,
        poster: entry.assets.poster,
        fanart: entry.assets.fanart,
        sceneImages: entry.assets.sceneImages,
        trailer: entry.assets.trailer,
        downloaded: [],
      };

      if (steps.download && plan && crawlerData) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] 下载资源...`);
        const forceReplace = this.getForcedPrimaryImageRefresh(entry, crawlerData);
        assets = await this.deps.downloadManager.downloadAll(plan.outputDir, crawlerData, config, imageAlternatives, {
          onSceneProgress: (downloaded, total) => {
            this.deps.signalService.showLogText(`[${fileInfo.number}] 场景图: ${downloaded}/${total}`);
          },
          forceReplace,
          assetDecisions: committed?.assetDecisions,
        });
      }

      this.setProgress(progress, 75);

      // Step 5: Generate NFO (if enabled)
      let savedNfoPath: string | undefined;
      if (steps.generateNfo && plan && crawlerData) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] 生成 NFO...`);
        let videoMeta: VideoMeta | undefined;
        try {
          videoMeta = await probeVideoMetadata(fileInfo.filePath);
        } catch {
          this.logger.warn(`Video probe failed for ${fileInfo.filePath}`);
        }
        const preparedNfoData = await prepareCrawlerDataForNfo(this.actorImageService, config, crawlerData, {
          movieDir: plan.outputDir,
          sourceVideoPath: fileInfo.filePath,
        });
        preparedCrawlerData = preparedNfoData.data;
        preparedActorPhotoPaths = preparedNfoData.actorPhotoPaths;
        savedNfoPath = await this.deps.nfoGenerator.writeNfo(plan.nfoPath, preparedCrawlerData, {
          assets,
          sources: aggregationSources,
          videoMeta,
        });
      }

      this.setProgress(progress, 80);

      // Step 6: Organize files (if enabled)
      let outputVideoPath = fileInfo.filePath;
      if (steps.organize && plan) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] 整理文件...`);
        outputVideoPath = await this.deps.fileOrganizer.organizeVideo(fileInfo, plan, config);
      }

      const resolvedArtifacts = await this.resolveArtifacts(
        entry,
        plan,
        outputVideoPath,
        assets,
        savedNfoPath,
        preparedActorPhotoPaths,
      );
      const resolvedAssets = this.toDownloadedAssets(assets, resolvedArtifacts.assets);
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
      const prepared = await this.prepareFile(entry, config, signal, {
        createDirectories: false,
        emitLogs: false,
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

  private async prepareFile(
    entry: LocalScanEntry,
    config: Configuration,
    signal: AbortSignal | undefined,
    options: {
      createDirectories: boolean;
      emitLogs: boolean;
      progress?: FileScrapeProgress;
    },
  ): Promise<PreparedMaintenanceFile> {
    const { fileInfo } = entry;
    const { steps } = this.preset;
    let crawlerData: CrawlerData | undefined;
    let aggregationSources: SourceMap | undefined;
    let imageAlternatives: MaintenanceImageAlternatives = {};

    if (!steps.aggregate && entry.scanError) {
      throw new Error(entry.scanError);
    }

    if (steps.aggregate) {
      if (options.emitLogs) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] 联网获取元数据...`);
      }

      const aggregationResult = await this.deps.aggregationService.aggregate(fileInfo.number, config, signal);

      if (!aggregationResult) {
        throw new Error("联网获取元数据失败：无数据返回");
      }

      crawlerData = aggregationResult.data;
      aggregationSources = aggregationResult.sources;
      imageAlternatives = aggregationResult.imageAlternatives;
    } else {
      crawlerData = entry.crawlerData;
    }

    if (options.progress) {
      this.setProgress(options.progress, 30);
    }

    if (steps.translate) {
      if (!crawlerData) {
        throw new Error("无元数据可供翻译");
      }

      if (options.emitLogs) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] 翻译元数据...`);
      }
      crawlerData = await this.deps.translateService.translateCrawlerData(crawlerData, config);
    }

    const comparisonBase = steps.aggregate ? this.buildDiffBaseline(entry, crawlerData) : undefined;
    const { fieldDiffs, unchangedFieldDiffs } =
      comparisonBase && crawlerData && steps.aggregate
        ? partitionCrawlerDataWithOptions(comparisonBase, crawlerData, {
            includeTranslatedFields: config.translate.enableTranslation,
            entry,
            imageAlternatives,
          })
        : { fieldDiffs: undefined, unchangedFieldDiffs: undefined };

    if (options.progress) {
      this.setProgress(options.progress, 50);
    }

    const needsPlan = steps.download || steps.generateNfo || steps.organize;
    let plan: OrganizePlan | undefined;
    let pathDiff: PathDiff | undefined;

    if (needsPlan) {
      if (!crawlerData) {
        throw new Error("本地 NFO 不存在或无法解析，无法执行后续步骤");
      }

      const rawPlan = this.deps.fileOrganizer.plan(fileInfo, crawlerData, config);
      plan = await this.deps.fileOrganizer.resolveOutputPlan(rawPlan, fileInfo.filePath, {
        createDirectories: options.createDirectories,
      });
      pathDiff = diffPaths(entry, plan);
    }

    return {
      crawlerData,
      fieldDiffs,
      unchangedFieldDiffs,
      aggregationSources,
      imageAlternatives,
      plan,
      pathDiff,
    };
  }

  private async prepareCommittedFile(
    entry: LocalScanEntry,
    config: Configuration,
    committed: CommittedMaintenanceFile,
    options: {
      createDirectories: boolean;
      progress?: FileScrapeProgress;
    },
  ): Promise<PreparedMaintenanceFile> {
    const { fileInfo } = entry;
    const { steps } = this.preset;

    if (!steps.aggregate && entry.scanError) {
      throw new Error(entry.scanError);
    }

    const crawlerData = committed.crawlerData ?? entry.crawlerData;
    const comparisonBase = steps.aggregate ? this.buildDiffBaseline(entry, crawlerData) : undefined;
    const { fieldDiffs, unchangedFieldDiffs } =
      comparisonBase && crawlerData && steps.aggregate
        ? partitionCrawlerDataWithOptions(comparisonBase, crawlerData, {
            includeTranslatedFields: config.translate.enableTranslation,
            entry,
            imageAlternatives: committed.imageAlternatives,
          })
        : { fieldDiffs: undefined, unchangedFieldDiffs: undefined };

    if (options.progress) {
      this.setProgress(options.progress, 50);
    }

    const needsPlan = steps.download || steps.generateNfo || steps.organize;
    let plan: OrganizePlan | undefined;
    let pathDiff: PathDiff | undefined;

    if (needsPlan) {
      if (!crawlerData) {
        throw new Error("未提供最终元数据，无法执行写入");
      }

      const rawPlan = this.deps.fileOrganizer.plan(fileInfo, crawlerData, config);
      plan = await this.deps.fileOrganizer.resolveOutputPlan(rawPlan, fileInfo.filePath, {
        createDirectories: options.createDirectories,
      });
      pathDiff = diffPaths(entry, plan);
    }

    return {
      crawlerData,
      fieldDiffs,
      unchangedFieldDiffs,
      imageAlternatives: committed.imageAlternatives ?? {},
      plan,
      pathDiff,
    };
  }

  private async resolveArtifacts(
    entry: LocalScanEntry,
    plan: OrganizePlan | undefined,
    outputVideoPath: string,
    assets: DownloadedAssets,
    savedNfoPath?: string,
    preparedActorPhotoPaths: string[] = [],
  ): Promise<ResolvedMaintenanceArtifacts> {
    if (!plan) {
      const nfoPath = savedNfoPath ?? entry.nfoPath;
      return {
        nfoPath,
        assets: {
          thumb: assets.thumb,
          poster: assets.poster,
          fanart: assets.fanart,
          sceneImages: assets.sceneImages,
          trailer: assets.trailer,
          nfo: nfoPath,
          actorPhotos: preparedActorPhotoPaths.length > 0 ? preparedActorPhotoPaths : entry.assets.actorPhotos,
        },
      };
    }

    const outputDir = dirname(outputVideoPath);
    const nfoPath = await this.resolveNfoPath(entry, plan, savedNfoPath);

    return {
      nfoPath,
      assets: {
        thumb: await this.resolvePrimaryAsset(entry.assets.thumb, assets.thumb, outputDir),
        poster: await this.resolvePrimaryAsset(entry.assets.poster, assets.poster, outputDir),
        fanart: await this.resolvePrimaryAsset(entry.assets.fanart, assets.fanart, outputDir),
        sceneImages: await this.resolveAssetCollection(entry.assets.sceneImages, assets.sceneImages, outputDir),
        trailer: await this.resolvePrimaryAsset(entry.assets.trailer, assets.trailer, outputDir),
        nfo: nfoPath,
        actorPhotos:
          preparedActorPhotoPaths.length > 0
            ? preparedActorPhotoPaths
            : await this.resolveAssetCollection(entry.assets.actorPhotos, [], outputDir),
      },
    };
  }

  private async resolveNfoPath(
    entry: LocalScanEntry,
    plan: OrganizePlan,
    savedNfoPath?: string,
  ): Promise<string | undefined> {
    if (savedNfoPath) {
      await this.removeStaleOriginalNfo(entry.nfoPath, savedNfoPath);
      return savedNfoPath;
    }

    const movedNfoPath = await this.moveKnownAsset(entry.nfoPath, plan.nfoPath);
    if (movedNfoPath) {
      await this.ensureMovieNfoAlias(movedNfoPath);
    }
    return movedNfoPath;
  }

  private async resolvePrimaryAsset(
    sourcePath: string | undefined,
    preferredPath: string | undefined,
    outputDir: string,
  ): Promise<string | undefined> {
    if (preferredPath) {
      return preferredPath;
    }

    if (!sourcePath) {
      return undefined;
    }

    return await this.moveKnownAsset(sourcePath, join(outputDir, basename(sourcePath)));
  }

  private async resolveAssetCollection(
    sourcePaths: string[],
    preferredPaths: string[],
    outputDir: string,
  ): Promise<string[]> {
    if (preferredPaths.length > 0) {
      return preferredPaths;
    }

    const resolved: string[] = [];
    for (const sourcePath of sourcePaths) {
      const targetPath = join(outputDir, basename(dirname(sourcePath)), basename(sourcePath));
      const movedPath = await this.moveKnownAsset(sourcePath, targetPath);
      if (movedPath) {
        resolved.push(movedPath);
      }
    }
    return resolved;
  }

  private async moveKnownAsset(sourcePath: string | undefined, targetPath: string): Promise<string | undefined> {
    if (!sourcePath) {
      return undefined;
    }

    if (sourcePath === targetPath) {
      return (await pathExists(sourcePath)) ? sourcePath : undefined;
    }

    if (!(await pathExists(sourcePath))) {
      return (await pathExists(targetPath)) ? targetPath : undefined;
    }

    if (await pathExists(targetPath)) {
      return targetPath;
    }

    return await moveFileSafely(sourcePath, targetPath);
  }

  private async removeStaleOriginalNfo(originalNfoPath: string | undefined, savedNfoPath: string): Promise<void> {
    if (!originalNfoPath) {
      return;
    }

    const movieNfoPath = join(dirname(savedNfoPath), "movie.nfo");
    if (originalNfoPath === savedNfoPath || originalNfoPath === movieNfoPath) {
      return;
    }

    if (!(await pathExists(originalNfoPath))) {
      return;
    }

    try {
      await unlink(originalNfoPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to remove stale NFO ${originalNfoPath}: ${message}`);
    }
  }

  private async ensureMovieNfoAlias(nfoPath: string): Promise<void> {
    const movieNfoPath = join(dirname(nfoPath), "movie.nfo");
    if (movieNfoPath === nfoPath || !(await pathExists(nfoPath))) {
      return;
    }

    try {
      await copyFile(nfoPath, movieNfoPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to sync movie.nfo alias for ${nfoPath}: ${message}`);
    }
  }

  private toDownloadedAssets(currentAssets: DownloadedAssets, resolvedAssets: DiscoveredAssets): DownloadedAssets {
    return {
      thumb: resolvedAssets.thumb,
      poster: resolvedAssets.poster,
      fanart: resolvedAssets.fanart,
      sceneImages: resolvedAssets.sceneImages,
      trailer: resolvedAssets.trailer,
      downloaded: currentAssets.downloaded,
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

  private buildDiffBaseline(entry: LocalScanEntry, crawlerData: CrawlerData | undefined): CrawlerData | undefined {
    if (entry.crawlerData) {
      return entry.crawlerData;
    }

    if (!crawlerData) {
      return undefined;
    }

    return {
      title: "",
      number: crawlerData.number || entry.fileInfo.number,
      actors: [],
      genres: [],
      sample_images: [],
      website: crawlerData.website,
    };
  }

  private getForcedPrimaryImageRefresh(
    entry: LocalScanEntry,
    crawlerData: CrawlerData,
  ): Partial<Record<"thumb" | "poster" | "fanart", boolean>> {
    const forceReplace: Partial<Record<"thumb" | "poster" | "fanart", boolean>> = {};
    const mappings = [
      { field: "thumb_url" as const, key: "thumb" as const },
      { field: "poster_url" as const, key: "poster" as const },
      { field: "fanart_url" as const, key: "fanart" as const },
    ];

    for (const { field, key } of mappings) {
      const nextValue = this.normalizeComparableUrl(crawlerData[field]);
      const currentValue = this.normalizeComparableUrl(entry.crawlerData?.[field]);
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
    return value?.trim() ?? "";
  }
}
