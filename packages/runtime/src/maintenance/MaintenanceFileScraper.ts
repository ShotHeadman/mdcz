import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { MaintenanceMovieGroup } from "@mdcz/shared/maintenanceTasks";
import type {
  CrawlerData,
  DiscoveredAssets,
  DownloadedAssets,
  LocalScanEntry,
  MaintenanceImageAlternatives,
  MaintenanceItemResult,
  MaintenancePreviewItem,
} from "@mdcz/shared/types";
import { resolvePublicationAssetLayout } from "../publication/assetLayout";
import type { CommittedMovie } from "../publication/committedMovie";
import { toCommittedMovie } from "../publication/committedMovie";
import { PublicationConflictError } from "../publication/conflicts";
import { MoveOutput } from "../publication/MoveOutput";
import { prepareMovieArtifacts, retainedRegisteredFeatures } from "../publication/movieArtifacts";
import { acquireOutputDirectories } from "../publication/outputMutex";
import type { PublicationJournalPort } from "../publication/types";
import { WriteOutput } from "../publication/WriteOutput";
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
import type { DirectoryInventory } from "../scrape/DirectoryInventory";
import type { FileScraperDependencies } from "../scrape/FileScraper";
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
  inventory: DirectoryInventory;
  outputTemplateRoot?: string;
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
  outputRelativePath?: string;
  outputSize?: number;
  outputModifiedAt?: Date;
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
        inventory: deps.inventory,
        aggregationService: deps.aggregationService,
        translateService: deps.translateService,
        fileOrganizer: deps.fileOrganizer,
        signalService: deps.signalService,
        outputTemplateRoot: deps.outputTemplateRoot,
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
    files: LocalScanEntry[] = [entry],
    publication?: {
      journal: PublicationJournalPort;
      commit(movie: CommittedMovie): void;
      operationId: string;
      roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
      identity: Pick<MaintenanceMovieGroup, "movieId" | "assets">;
    },
  ): Promise<MaintenanceFileScrapeResult> {
    const { fileInfo } = entry;
    this.logger.info(`[${this.preset.id}] Processing ${fileInfo.number} (${fileInfo.fileName})`);
    this.setProgress(progress, 0);

    let stagingDir: string | undefined;
    try {
      throwIfAborted(signal);
      const group = await this.preparationService.prepareApply(
        entry,
        files,
        config,
        {
          onProgress: (stepPercent) => this.setProgress(progress, stepPercent),
          signal,
        },
        committed,
      );
      const prepared = group.shared;
      const { crawlerData, fieldDiffs, unchangedFieldDiffs, aggregationSources, imageAlternatives, plan, pathDiff } =
        prepared;
      if (!publication) throw new Error("Maintenance publication identity is required");
      const members = await Promise.all(
        group.files.map(async ({ entry: file, plan }) => {
          if (!plan) throw new Error(`Maintenance file has no resolved layout: ${file.fileId}`);
          const { sourceVideoPath: _sourceVideoPath, ...layout } = plan;
          return {
            source: file.ref,
            fileId: file.fileId,
            fileInfo: file.fileInfo,
            layout,
            assetLayout: await resolvePublicationAssetLayout({
              inventory: this.deps.inventory,
              layout: plan,
              config,
              crawlerData,
              existingAssets: file.assets,
              assetDecisions: committed?.assetDecisions,
              movieBaseName: group.shared.plan ? basename(group.shared.plan.nfoPath, ".nfo") : undefined,
            }),
            existingAssets: file.assets,
            existingNfoPath: file.nfoPath,
          };
        }),
      );
      const stagingParent = members[0].layout.metadataDir;
      if (this.preset.dataSource === "online") {
        await mkdir(stagingParent, { recursive: true });
        stagingDir = await mkdtemp(join(stagingParent, ".mdcz-staging-"));
      }
      const preparedOutputData = stagingDir
        ? await prepareOutputCrawlerData({
            actorImageService: this.actorImageService,
            actorSourceProvider: this.deps.actorSourceProvider,
            config,
            crawlerData,
            enabled: Boolean(plan),
            movieDir: stagingDir,
            sourceVideoPath: fileInfo.filePath,
            signal,
          })
        : { data: crawlerData, actorPhotoPaths: [] };
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
        plan?.nfoPath ? basename(plan.nfoPath, ".nfo") : fileInfo.fileName,
        signal,
      );
      preparedCrawlerData = downloaded.crawlerData;
      throwIfAborted(signal);
      const published = await prepareMovieArtifacts({
        inventory: this.deps.inventory,
        roots: publication.roots,
        members,
        retainedMovieAssets: retainedRegisteredFeatures(members, publication.identity.assets),
        stagingDir,
        downloadedAssets: downloaded.assets,
        actorPhotoPaths: preparedActorPhotoPaths,
        assetDecisions: committed?.assetDecisions,
        nfoNaming: config.download.nfoNaming,
        writeNfo: async (assets, writeFile) =>
          await writePreparedNfo({
            assets,
            config,
            crawlerData: preparedCrawlerData,
            enabled: Boolean(this.preset.dataSource === "online" && plan),
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
      throwIfAborted(signal);
      const file = published.files.find((candidate) => candidate.fileId === entry.fileId);
      if (!file) throw new Error("Maintenance publication requires the selected media member");
      const strm = file.assets.find((asset) => asset.kind === "strm");
      const targetRoot =
        publication.roots.find((root) => root.id === file.target.rootId) ??
        (() => {
          throw new Error(`Publication root not found: ${file.target.rootId}`);
        })();
      const targetPath = resolveRootRelativePath(targetRoot, file.target.relativePath);
      const updatedEntry = this.buildUpdatedEntry(entry, preparedCrawlerData, {
        fileInfo: { ...fileInfo, filePath: targetPath },
        currentDir: plan?.outputDir ?? dirname(targetPath),
        nfoPath: published.nfoPath,
        strmPath:
          strm?.type === "local"
            ? resolveRootRelativePath(
                publication.roots.find((root) => root.id === strm.file.rootId) ??
                  (() => {
                    throw new Error(`Publication root not found: ${strm.file.rootId}`);
                  })(),
                strm.file.relativePath,
              )
            : entry.strmPath,
        assets: published.assets,
      });
      this.setProgress(progress, 100);
      const output = published;
      if (!preparedCrawlerData) throw new Error("Maintenance output requires movie metadata");
      const movie = toCommittedMovie(
        { ...output, movieId: publication.identity.movieId },
        { crawlerData: preparedCrawlerData, sources: aggregationSources },
      );
      const unlock = await acquireOutputDirectories([
        ...output.moves.map((move) => move.targetPath),
        ...output.artifacts.map((artifact) => artifact.targetPath),
      ]);
      let cleanupIssues: unknown[];
      try {
        throwIfAborted(signal);
        const validate = async () => {
          throwIfAborted(signal);
          await this.deps.inventory.assertUnchanged(files.flatMap((file) => (file.nfoPath ? [file.nfoPath] : [])));
          throwIfAborted(signal);
        };
        const commit = () => publication.commit(movie);
        const installed = output.moves.length
          ? await new MoveOutput().install({
              operationId: publication.operationId,
              operationType: "maintenance",
              moves: output.moves,
              artifacts: output.artifacts,
              protectedSourceRoots: output.protectedSourceRoots,
              journal: publication.journal,
              validate,
              commit,
            })
          : await new WriteOutput().install(output.artifacts, {
              protectedSourceRoots: output.protectedSourceRoots,
              validate,
              commit,
            });
        cleanupIssues = installed.cleanupIssues;
      } finally {
        unlock();
      }
      const result: MaintenanceFileScrapeResult = {
        fileId: entry.fileId,
        status: "success",
        crawlerData: preparedCrawlerData,
        updatedEntry,
        fieldDiffs,
        unchangedFieldDiffs,
        pathDiff,
        outputRelativePath: file.target.relativePath,
        outputSize: file.size,
        outputModifiedAt: file.modifiedAt,
        ...(cleanupIssues.length ? { error: cleanupIssues.map((error) => toErrorMessage(error)).join("; ") } : {}),
      };
      return result;
    } catch (error) {
      if (isAbortError(error) || error instanceof PublicationConflictError) throw error;
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
    files: LocalScanEntry[] = [entry],
  ): Promise<
    MaintenancePreviewItem & { affectedFiles?: Array<{ fileId: string; currentPath: string; targetPath: string }> }
  > {
    try {
      const group = await this.preparationService.preview(entry, files, config, signal);
      const prepared = group.shared;

      return {
        fileId: entry.fileId,
        status: "ready",
        fieldDiffs: prepared.fieldDiffs,
        unchangedFieldDiffs: prepared.unchangedFieldDiffs,
        pathDiff: prepared.pathDiff,
        proposedCrawlerData: prepared.crawlerData,
        imageAlternatives: prepared.imageAlternatives,
        affectedFiles: group.files.map(({ entry, plan }) => ({
          fileId: entry.fileId,
          currentPath: entry.fileInfo.filePath,
          targetPath: this.preset.output === "move" && plan ? plan.targetVideoPath : entry.fileInfo.filePath,
        })),
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
      strmPath: updates.strmPath,
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

    if (!(this.preset.dataSource === "online" && outputDir && preparedCrawlerData)) {
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
              signalService: this.deps.signalService,
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
