import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import { isMovieNfoBaseName } from "@mdcz/shared/assetNaming";
import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { MaintenanceMovieGroup } from "@mdcz/shared/maintenanceTasks";
import type {
  CrawlerData,
  DiscoveredAssets,
  DownloadedAssets,
  FieldDiff,
  FileInfo,
  LocalScanEntry,
  MaintenanceImageAlternatives,
  MaintenancePresetId,
  MaintenancePreviewStatus,
  NfoLocalState,
  PathDiff,
} from "@mdcz/shared/types";
import { resolvePublicationAssetLayout } from "../publication/assetLayout";
import type { CommittedMovie } from "../publication/committedMovie";
import { toCommittedMovie } from "../publication/committedMovie";
import { PublicationConflictError } from "../publication/conflicts";
import { MoveOutput } from "../publication/MoveOutput";
import { type MovieArtifacts, prepareMovieArtifacts, retainedRegisteredFeatures } from "../publication/movieArtifacts";
import { acquireOutputDirectories } from "../publication/outputMutex";
import type { PublicationJournalPort } from "../publication/types";
import { WriteOutput } from "../publication/WriteOutput";
import {
  type AggregationService,
  applyScrapeNetworkPolicy,
  type DownloadManager,
  downloadCrawlerAssets,
  type FileOrganizer,
  type NfoGenerator,
  prepareOutputCrawlerData,
  type ResolvedPublicationLayout,
  type ScrapeNetworkPolicyClient,
  type TranslateService,
  writePreparedNfo,
} from "../scrape";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "../scrape/actorOutput";
import { canonicalizeCrawlerDataActorAliases } from "../scrape/canonicalizeActorAliases";
import { DirectoryInventory } from "../scrape/DirectoryInventory";
import { isAbortError, throwIfAborted } from "../scrape/utils/abort";
import { partitionCrawlerDataWithOptions } from "./diffCrawlerData";
import { diffPaths } from "./diffPaths";
import { LocalScanService } from "./LocalScanService";
import { buildMovieTags } from "./movieTags";
import { getMaintenancePreset, type MaintenancePreset, supportsMaintenanceExecution } from "./presets";

export interface MaintenanceSignalService {
  setProgress(value: number, current: number, total: number): void;
  showLogText(message: string): void;
}

export interface MaintenanceRuntimeConfigProvider {
  get(): Promise<Configuration>;
}

export interface MaintenanceRuntimeDependencies {
  actorImageService: RuntimeActorImageService;
  actorSourceProvider?: RuntimeActorSourceProvider;
  aggregationService?: AggregationService;
  config: MaintenanceRuntimeConfigProvider;
  downloadManager?: DownloadManager;
  fileOrganizer: Pick<FileOrganizer, "plan" | "resolveOutputPlan">;
  networkPolicyClient?: ScrapeNetworkPolicyClient;
  nfoGenerator: Pick<NfoGenerator, "writeNfo">;
  signalService: MaintenanceSignalService;
  translateService?: TranslateService;
  postProcessAssets?: (input: {
    assets: DownloadedAssets;
    configuration: Configuration;
    crawlerData: CrawlerData;
    fileInfo: FileInfo;
    localState?: NfoLocalState;
    signal?: AbortSignal;
    signalService: Pick<MaintenanceSignalService, "showLogText" | "setProgress">;
  }) => Promise<DownloadedAssets>;
}

export interface MaintenanceRuntimePreviewMovieInput {
  root: MediaRoot;
  presetId: MaintenancePresetId;
  entry: LocalScanEntry;
  files: LocalScanEntry[];
  signal?: AbortSignal;
}

export interface MaintenanceRuntimePreviewItem {
  files?: LocalScanEntry[];
  affectedFiles?: Array<{ fileId: string; currentPath: string; targetPath: string }>;
  entry: LocalScanEntry;
  rootId: string;
  relativePath: string;
  status: MaintenancePreviewStatus;
  error: string | null;
  fieldDiffs: FieldDiff[];
  unchangedFieldDiffs: FieldDiff[];
  pathDiff: PathDiff | null;
  proposedCrawlerData: CrawlerData | null;
  imageAlternatives?: MaintenanceImageAlternatives;
}

export interface MaintenanceRuntimeApplyEntryInput {
  root: MediaRoot;
  presetId: MaintenancePresetId;
  entry: LocalScanEntry;
  files?: LocalScanEntry[];
  committed?: {
    crawlerData?: CrawlerData;
    imageAlternatives?: MaintenanceImageAlternatives;
    assetDecisions?: import("@mdcz/shared/types").MaintenanceAssetDecisions;
  };
  publication: {
    journal: PublicationJournalPort;
    commit(movie: CommittedMovie): void;
    operationId: string;
    roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
    identity: Pick<MaintenanceMovieGroup, "movieId" | "assets">;
  };
  progress?: { fileIndex: number; totalFiles: number };
  signalService?: MaintenanceSignalService;
  signal?: AbortSignal;
}

export interface MaintenanceRuntimeApplySuccess {
  status: "success";
  entry: LocalScanEntry;
  crawlerData?: CrawlerData;
  fieldDiffs?: FieldDiff[];
  unchangedFieldDiffs?: FieldDiff[];
  pathDiff?: PathDiff;
  outputRelativePath: string;
  outputSize?: number;
  outputModifiedAt?: Date;
  output?: MovieArtifacts & { assets: DiscoveredAssets; nfoPath?: string };
  error?: string | null;
}

export interface MaintenanceRuntimeApplyFailure {
  status: "failed";
  error: string;
}

export type MaintenanceRuntimeApplyResult = MaintenanceRuntimeApplySuccess | MaintenanceRuntimeApplyFailure;

const mergeDeep = <T>(base: T, override: DeepPartial<T>): T => {
  if (
    override === undefined ||
    Array.isArray(base) ||
    Array.isArray(override) ||
    typeof base !== "object" ||
    base === null ||
    typeof override !== "object" ||
    override === null
  ) {
    return (override === undefined ? base : override) as T;
  }

  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    merged[key] = key in merged ? mergeDeep(merged[key], value as never) : value;
  }
  return merged as T;
};

export class MaintenanceRuntime {
  private readonly localScanService = new LocalScanService();

  constructor(
    private readonly deps: MaintenanceRuntimeDependencies,
    private readonly sourceMediaPath?: string,
    private readonly outputTemplateRoot?: string,
    readonly inventory = new DirectoryInventory(),
  ) {}

  async getConfiguration(): Promise<Configuration> {
    return structuredClone(await this.deps.config.get());
  }

  async createSession(input: {
    inventory: DirectoryInventory;
    configuration?: Configuration;
    root: MediaRoot;
    outputRoot: MediaRoot;
    outputRelativeDirectory: string;
  }): Promise<MaintenanceRuntime> {
    const config = structuredClone(input.configuration ?? (await this.getConfiguration()));
    const sourceMediaPath = config.paths.mediaPath.trim() || input.root.hostPath;
    const outputBaseDirectory = input.outputRelativeDirectory
      ? resolveRootRelativePath(input.outputRoot, input.outputRelativeDirectory)
      : input.outputRoot.hostPath;
    return new MaintenanceRuntime(
      { ...this.deps, config: { get: async () => config } },
      sourceMediaPath,
      outputBaseDirectory,
      input.inventory,
    );
  }

  async applyNetworkPolicy(): Promise<void> {
    if (!this.deps.networkPolicyClient) return;
    applyScrapeNetworkPolicy(this.deps.networkPolicyClient, await this.deps.config.get());
  }

  async scanRefs(input: {
    root: MediaRoot;
    refs: Array<{ relativePath: string }>;
    signal?: AbortSignal;
    registeredOutputs?: Map<string, { nfoPath?: string; strmPath?: string }>;
  }): Promise<LocalScanEntry[]> {
    const config = await this.getPresetConfig("inspect_local");
    const filePaths = input.refs.map((ref) => resolveRootRelativePath(input.root, ref.relativePath));
    return await this.localScanService.scanFiles(input.root, filePaths, config.paths.sceneImagesFolder, input.signal, {
      mediaPath: this.sourceMediaPath ?? config.paths.mediaPath,
      metadataPath: "",
      registeredOutputs: input.registeredOutputs,
      inventory: this.inventory,
    });
  }

  async previewMovie(input: MaintenanceRuntimePreviewMovieInput): Promise<MaintenanceRuntimePreviewItem> {
    const preset = getMaintenancePreset(input.presetId);
    const config = await this.getPresetConfig(input.presetId);

    if (!supportsMaintenanceExecution(preset)) {
      return { ...this.localEntryToPreviewItem(input.root, input.entry), files: input.files };
    }

    const { entry, files, signal } = input;
    try {
      throwIfAborted(signal);

      if (preset.dataSource === "local" && entry.scanError) {
        throw new Error(entry.scanError);
      }

      let crawlerData: CrawlerData | undefined;
      let imageAlternatives: MaintenanceImageAlternatives = {};
      if (preset.dataSource === "online") {
        if (!this.deps.aggregationService || !this.deps.translateService) {
          throw new Error("在线预设缺少必要的聚合或翻译服务");
        }
        const aggregationResult = await this.deps.aggregationService.aggregate(entry.fileInfo.number, config, signal);
        throwIfAborted(signal);
        if (!aggregationResult) {
          throw new Error("联网获取元数据失败：无数据返回");
        }
        const translated = await this.deps.translateService.translateCrawlerData(
          aggregationResult.data,
          config,
          signal,
        );
        crawlerData = translated.data;
        imageAlternatives = aggregationResult.imageAlternatives;
      } else {
        crawlerData = entry.crawlerData;
      }

      if (crawlerData) {
        crawlerData = canonicalizeCrawlerDataActorAliases(crawlerData, config);
      }

      const { fieldDiffs, unchangedFieldDiffs } = this.partitionDiffs(
        entry,
        config,
        preset,
        crawlerData,
        imageAlternatives,
      );

      const { plan, pathDiff } = await this.buildPlan(entry, config, preset, crawlerData, signal);

      const affectedFiles: Array<{ fileId: string; currentPath: string; targetPath: string }> = [];
      for (const file of files) {
        if (preset.dataSource === "local" && file.scanError) throw new Error(file.scanError);
        const memberPlan =
          file.fileInfo.filePath === entry.fileInfo.filePath
            ? plan
            : (await this.buildPlan(file, config, preset, crawlerData, signal)).plan;
        affectedFiles.push({
          fileId: file.fileId,
          currentPath: file.fileInfo.filePath,
          targetPath: preset.output === "move" && memberPlan ? memberPlan.targetVideoPath : file.fileInfo.filePath,
        });
      }

      return {
        entry,
        rootId: input.root.id,
        relativePath: this.toRelativePath(input.root, entry.fileInfo.filePath),
        status: "ready",
        error: null,
        fieldDiffs: fieldDiffs ?? [],
        unchangedFieldDiffs: unchangedFieldDiffs ?? [],
        pathDiff: pathDiff ?? null,
        proposedCrawlerData: crawlerData ?? null,
        imageAlternatives,
        affectedFiles,
        files,
      };
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      return {
        entry,
        rootId: input.root.id,
        relativePath: this.toRelativePath(input.root, entry.fileInfo.filePath),
        status: "blocked",
        error: toErrorMessage(error),
        fieldDiffs: [],
        unchangedFieldDiffs: [],
        pathDiff: null,
        proposedCrawlerData: null,
        files,
      };
    }
  }

  async applyEntry(input: MaintenanceRuntimeApplyEntryInput): Promise<MaintenanceRuntimeApplyResult> {
    const preset = getMaintenancePreset(input.presetId);
    if (!supportsMaintenanceExecution(preset))
      throw new Error(`Maintenance preset ${preset.id} does not support execution`);

    const { entry, root: _root, files = [entry], committed, publication, signal } = input;
    const config = await this.getPresetConfig(input.presetId);
    throwIfAborted(signal);

    const crawlerData = committed?.crawlerData ?? entry.crawlerData;
    if (!crawlerData) throw new Error("Maintenance output requires movie metadata");

    const sharedPlan = await this.buildPlan(entry, config, preset, crawlerData, signal);
    const members = await Promise.all(
      files.map(async (file) => {
        const layout =
          file.fileInfo.filePath === entry.fileInfo.filePath
            ? sharedPlan.plan
            : (await this.buildPlan(file, config, preset, crawlerData, signal)).plan;
        if (!layout) throw new Error(`Maintenance file has no resolved layout: ${file.fileId}`);
        const { sourceVideoPath: _sourceVideoPath, ...outputLayout } = layout;
        return {
          source: file.ref,
          fileId: file.fileId,
          fileInfo: file.fileInfo,
          layout: outputLayout,
          assetLayout: await resolvePublicationAssetLayout({
            inventory: this.inventory,
            layout,
            config,
            crawlerData,
            existingAssets: file.assets,
            assetDecisions: committed?.assetDecisions,
            movieBaseName: sharedPlan.plan ? basename(sharedPlan.plan.nfoPath, ".nfo") : undefined,
          }),
          existingAssets: file.assets,
          existingNfoPath: file.nfoPath,
        };
      }),
    );

    let stagingDir: string | undefined;
    try {
      const stagingParent = members[0].layout.metadataDir;
      if (preset.dataSource === "online") {
        await mkdir(stagingParent, { recursive: true });
        stagingDir = await mkdtemp(join(stagingParent, ".mdcz-staging-"));
      }

      const preparedOutputData = stagingDir
        ? await prepareOutputCrawlerData({
            actorImageService: this.deps.actorImageService,
            actorSourceProvider: this.deps.actorSourceProvider,
            config,
            crawlerData,
            enabled: Boolean(sharedPlan.plan),
            movieDir: stagingDir,
            sourceVideoPath: entry.fileInfo.filePath,
            signal,
          })
        : { data: crawlerData, actorPhotoPaths: [] };
      throwIfAborted(signal);

      let preparedCrawlerData = preparedOutputData.data ?? crawlerData;
      const preparedActorPhotoPaths = preparedOutputData.actorPhotoPaths;

      let downloadedAssets: DownloadedAssets = {
        poster: undefined,
        fanart: undefined,
        thumb: undefined,
        trailer: undefined,
        sceneImages: [],
        downloaded: [],
      };

      if (stagingDir && preset.dataSource === "online") {
        if (!this.deps.downloadManager) {
          throw new Error("在线预设缺少下载服务");
        }
        const downloaded = await downloadCrawlerAssets({
          config,
          crawlerData: preparedCrawlerData,
          downloadManager: this.deps.downloadManager,
          fileInfo: entry.fileInfo,
          imageAlternatives: committed?.imageAlternatives,
          movieBaseName: sharedPlan.plan ? basename(sharedPlan.plan.nfoPath, ".nfo") : entry.fileInfo.fileName,
          outputDir: stagingDir,
          existingAssetDir: stagingParent,
          sources: undefined,
          callbacks: { signal },
        });
        downloadedAssets = downloaded.assets;
        preparedCrawlerData = downloaded.crawlerData;
      }
      throwIfAborted(signal);

      if (this.deps.postProcessAssets && stagingDir && preset.dataSource === "online") {
        downloadedAssets = await this.deps.postProcessAssets({
          assets: downloadedAssets,
          configuration: config,
          crawlerData: preparedCrawlerData,
          fileInfo: entry.fileInfo,
          localState: entry.nfoLocalState,
          signal,
          signalService: this.deps.signalService,
        });
      }

      const published = await prepareMovieArtifacts({
        inventory: this.inventory,
        roots: publication.roots,
        members,
        retainedMovieAssets: retainedRegisteredFeatures(members, publication.identity.assets),
        stagingDir,
        downloadedAssets,
        actorPhotoPaths: preparedActorPhotoPaths,
        assetDecisions: committed?.assetDecisions,
        nfoNaming: config.download.nfoNaming,
        writeNfo: async (assets, writeFile) =>
          await writePreparedNfo({
            assets,
            config,
            crawlerData: preparedCrawlerData,
            enabled: Boolean((preset.dataSource === "online" || config.download.generateNfo) && sharedPlan.plan),
            fileInfo: entry.fileInfo,
            localState: entry.nfoLocalState,
            buildTags: buildMovieTags,
            nfoGenerator: this.deps.nfoGenerator,
            nfoPath: sharedPlan.plan?.nfoPath,
            sourceVideoPath: entry.fileInfo.filePath,
            sources: undefined,
            writeFile,
          }),
      });
      throwIfAborted(signal);

      const file = published.files.find((candidate) => candidate.fileId === entry.fileId);
      if (!file) throw new Error("Maintenance publication requires the selected media member");

      const movie = toCommittedMovie(
        { ...published, movieId: publication.identity.movieId },
        { crawlerData: preparedCrawlerData, sources: undefined },
      );

      const unlock = await acquireOutputDirectories([
        ...published.moves.map((move) => move.targetPath),
        ...published.artifacts.map((artifact) => artifact.targetPath),
      ]);
      let cleanupIssues: unknown[] = [];
      try {
        throwIfAborted(signal);
        const validate = async () => {
          throwIfAborted(signal);
          await this.inventory.assertUnchanged(files.flatMap((f) => (f.nfoPath ? [f.nfoPath] : [])));
          throwIfAborted(signal);
        };
        const commit = () => publication.commit(movie);
        if (published.moves.length) {
          const installed = await new MoveOutput().install({
            operationId: publication.operationId,
            operationType: "maintenance",
            moves: published.moves,
            artifacts: published.artifacts,
            protectedSourceRoots: published.protectedSourceRoots,
            journal: publication.journal,
            validate,
            commit,
          });
          cleanupIssues = installed.cleanupIssues;
        } else {
          const installed = await new WriteOutput().install(published.artifacts, {
            protectedSourceRoots: published.protectedSourceRoots,
            validate,
            commit,
          });
          cleanupIssues = installed.cleanupIssues;
        }
      } finally {
        unlock();
      }

      return {
        status: "success",
        entry: this.buildUpdatedEntry(entry, preparedCrawlerData, published, file, sharedPlan.plan, publication.roots),
        crawlerData: preparedCrawlerData,
        fieldDiffs: sharedPlan.fieldDiffs,
        unchangedFieldDiffs: sharedPlan.unchangedFieldDiffs,
        pathDiff: sharedPlan.pathDiff,
        outputRelativePath: file.target.relativePath,
        outputSize: file.size,
        outputModifiedAt: file.modifiedAt,
        output: published,
        error: cleanupIssues.length ? cleanupIssues.map((e) => toErrorMessage(e)).join("; ") : null,
      };
    } catch (error) {
      if (isAbortError(error) || error instanceof PublicationConflictError || publication === undefined) throw error;
      return { status: "failed", error: toErrorMessage(error) };
    } finally {
      if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
    }
  }

  private async buildPlan(
    entry: LocalScanEntry,
    config: Configuration,
    preset: MaintenancePreset,
    crawlerData: CrawlerData | undefined,
    signal?: AbortSignal,
  ): Promise<{
    plan?: ResolvedPublicationLayout;
    pathDiff?: PathDiff;
    fieldDiffs?: FieldDiff[];
    unchangedFieldDiffs?: FieldDiff[];
  }> {
    throwIfAborted(signal);

    if (preset.output === "none") {
      return { plan: undefined, pathDiff: undefined };
    }

    if (!crawlerData) {
      throw new Error("本地 NFO 不存在或无法解析，无法执行后续步骤");
    }

    if (preset.output === "write") {
      const layout = this.deps.fileOrganizer.plan(entry.fileInfo, crawlerData, config, entry.nfoLocalState);
      const metadataDir = entry.nfoPath
        ? dirname(entry.nfoPath)
        : entry.strmPath
          ? dirname(entry.strmPath)
          : layout.metadataDir;
      return {
        plan: await this.deps.fileOrganizer.resolveOutputPlan(
          {
            outputDir: entry.currentDir,
            metadataDir,
            metadataRoot: metadataDir,
            mode: "preserve",
            targetVideoPath: entry.fileInfo.filePath,
            nfoPath:
              entry.nfoPath && !isMovieNfoBaseName(basename(entry.nfoPath, ".nfo"))
                ? entry.nfoPath
                : join(metadataDir, basename(layout.nfoPath)),
            strmPath: entry.strmPath,
            renameSubtitles: false,
          },
          entry.fileInfo.filePath,
          {
            allowSharedDirectory: true,
            existingMetadataDir: entry.nfoPath ? dirname(entry.nfoPath) : entry.currentDir,
            strmPathMappings: config.paths.strmPathMappings,
            inventory: this.inventory,
          },
        ),
        pathDiff: undefined,
      };
    }

    const rawPlan = this.deps.fileOrganizer.plan(entry.fileInfo, crawlerData, config, entry.nfoLocalState, {
      outputTemplateRoot:
        this.outputTemplateRoot ??
        resolve(config.paths.mediaPath || entry.currentDir, config.paths.successOutputFolder),
    });

    const plan = await this.deps.fileOrganizer.resolveOutputPlan(rawPlan, entry.fileInfo.filePath, {
      allowSharedDirectory: config.naming.assetNamingMode === "followVideo" && config.download.nfoNaming === "filename",
      existingMetadataDir: entry.nfoPath ? dirname(entry.nfoPath) : entry.currentDir,
      strmPathMappings: config.paths.strmPathMappings,
      inventory: this.inventory,
    });

    return {
      plan,
      pathDiff: diffPaths(entry, plan),
    };
  }

  private partitionDiffs(
    entry: LocalScanEntry,
    config: Configuration,
    preset: MaintenancePreset,
    crawlerData: CrawlerData | undefined,
    imageAlternatives: MaintenanceImageAlternatives,
  ): { fieldDiffs?: FieldDiff[]; unchangedFieldDiffs?: FieldDiff[] } {
    if (preset.dataSource === "local" || !crawlerData) {
      return { fieldDiffs: undefined, unchangedFieldDiffs: undefined };
    }

    const comparisonBase = this.buildDiffBaseline(entry, crawlerData);
    if (!comparisonBase) {
      return { fieldDiffs: undefined, unchangedFieldDiffs: undefined };
    }

    return partitionCrawlerDataWithOptions(comparisonBase, crawlerData, {
      includeTranslatedFields: config.translate.enableTranslation,
      entry,
      imageAlternatives,
    });
  }

  private buildDiffBaseline(entry: LocalScanEntry, crawlerData: CrawlerData | undefined): CrawlerData | undefined {
    if (entry.crawlerData) {
      return {
        ...entry.crawlerData,
        trailer_url:
          entry.crawlerData.trailer_url ||
          (entry.assets.trailer ? entry.assets.trailer.split(/[\\/]/u).pop() : undefined),
      };
    }

    if (!crawlerData) {
      return undefined;
    }

    return {
      title: "",
      number: crawlerData.number || entry.fileInfo.number,
      actors: [],
      genres: [],
      scene_images: [],
      trailer_url: entry.assets.trailer ? entry.assets.trailer.split(/[\\/]/u).pop() : undefined,
      website: crawlerData.website,
    };
  }

  private buildUpdatedEntry(
    entry: LocalScanEntry,
    crawlerData: CrawlerData,
    published: MovieArtifacts & { assets: DiscoveredAssets; nfoPath?: string },
    pubFile: MovieArtifacts["files"][number] | undefined,
    plan: ResolvedPublicationLayout | undefined,
    roots: readonly Pick<MediaRoot, "id" | "hostPath">[],
  ): LocalScanEntry {
    const targetRoot = roots.find((root) => root.id === pubFile?.target.rootId);
    const targetPath =
      targetRoot && pubFile
        ? resolveRootRelativePath(targetRoot as MediaRoot, pubFile.target.relativePath)
        : entry.fileInfo.filePath;
    const strm = pubFile?.assets.find((asset) => asset.kind === "strm");
    const strmRoot = strm?.type === "local" ? roots.find((r) => r.id === strm.file.rootId) : undefined;
    const strmPath =
      strmRoot && strm?.type === "local"
        ? resolveRootRelativePath(strmRoot as MediaRoot, strm.file.relativePath)
        : entry.strmPath;

    return {
      ...entry,
      fileInfo: { ...entry.fileInfo, filePath: targetPath },
      currentDir: plan?.outputDir ?? dirname(targetPath),
      crawlerData: { ...entry.crawlerData, ...crawlerData },
      nfoPath: published.nfoPath,
      strmPath,
      assets: published.assets,
    };
  }

  private localEntryToPreviewItem(root: MediaRoot, entry: LocalScanEntry): MaintenanceRuntimePreviewItem {
    const relativePath = this.toRelativePath(root, entry.fileInfo.filePath);
    return {
      entry,
      rootId: root.id,
      relativePath,
      status: entry.scanError ? "blocked" : "ready",
      error: entry.scanError ?? null,
      fieldDiffs: [],
      unchangedFieldDiffs: [],
      pathDiff: {
        changed: false,
        currentDir: entry.currentDir,
        currentVideoPath: entry.fileInfo.filePath,
        fileId: entry.fileId,
        targetDir: entry.currentDir,
        targetVideoPath: entry.fileInfo.filePath,
      },
      proposedCrawlerData: entry.crawlerData ?? null,
    };
  }

  private toRelativePath(root: MediaRoot, filePath: string): string {
    try {
      return toRootRelativePath(root, filePath);
    } catch {
      return filePath;
    }
  }

  private async getPresetConfig(presetId: MaintenancePresetId): Promise<Configuration> {
    const preset = getMaintenancePreset(presetId);
    const baseConfig = await this.getConfiguration();
    return mergeDeep(baseConfig, preset.configOverrides);
  }
}
