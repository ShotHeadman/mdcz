import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { LibraryEntryRecord } from "@mdcz/persistence";
import { isMovieNfoBaseName } from "@mdcz/shared/assetNaming";
import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import type { Website } from "@mdcz/shared/enums";
import { toErrorMessage } from "@mdcz/shared/error";
import type { MaintenanceMovieGroup } from "@mdcz/shared/maintenanceTasks";
import type { PublicationTarget } from "@mdcz/shared/mediaLibrary";
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
import { registeredMediaLocations } from "../library/registeredMedia";
import { runWithScrapeItem } from "../network";
import { resolvePublicationAssetLayout } from "../publication/assetLayout";
import type { CommittedMovie } from "../publication/committedMovie";
import { toCommittedMovie } from "../publication/committedMovie";
import { PublicationConflictError } from "../publication/conflicts";
import { MoveOutput } from "../publication/MoveOutput";
import {
  MANAGED_MOVIE_ASSET_KINDS,
  type MovieArtifacts,
  prepareMovieArtifacts,
  retainedRegisteredFeatures,
} from "../publication/movieArtifacts";
import { acquireOutputDirectories } from "../publication/outputMutex";
import { toRootFileRef } from "../publication/outputRefs";
import { WriteOutput } from "../publication/WriteOutput";
import {
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
import { AggregationService, type CrawlerPort, mergeSiteData, type SiteResultSink } from "../scrape/aggregation";
import { canonicalizeCrawlerDataActorAliases } from "../scrape/canonicalizeActorAliases";
import { DirectoryInventory } from "../scrape/DirectoryInventory";
import { editedKeys } from "../scrape/nfoEdits";
import { assignVersionLabels } from "../scrape/organize/versionLabels";
import { prepareOnlineMetadata } from "../scrape/prepareOnlineMetadata";
import { publishMetadata } from "../scrape/publishMetadata";
import type { PrepareScrapeItem } from "../scrape/ScrapeRunner";
import { isAbortError, throwIfAborted } from "../scrape/utils/abort";
import { type RuntimeLogger, runtimeLoggerService } from "../shared";
import { partitionCrawlerDataWithOptions } from "./diffCrawlerData";
import { diffPaths } from "./diffPaths";
import { LocalScanService } from "./LocalScanService";
import { buildMovieTags } from "./movieTags";
import { getMaintenancePreset, type MaintenancePreset } from "./presets";

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
  aggregationService?: Pick<AggregationService, "aggregate">;
  crawlerProvider?: CrawlerPort;
  recordSiteResults?: SiteResultSink;
  /** The stored per-site rows for a number; `data` is the site's answer in its source language. */
  loadSiteResults?: (number: string) => Promise<ReadonlyArray<{ site: string; data?: unknown; sourceUrl?: string }>>;
  logger?: RuntimeLogger;
  /** Development record/replay names the recording an online refresh belongs to. */
  prepareScrapeItem?: PrepareScrapeItem;
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

export interface MaintenanceRuntimePreviewPathsInput {
  presetId: MaintenancePresetId;
  entry: LocalScanEntry;
  files: LocalScanEntry[];
  crawlerData: CrawlerData | undefined;
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
  presetId: MaintenancePresetId;
  entry: LocalScanEntry;
  files?: LocalScanEntry[];
  committed?: {
    crawlerData?: CrawlerData;
    imageAlternatives?: MaintenanceImageAlternatives;
    assetDecisions?: import("@mdcz/shared/types").MaintenanceAssetDecisions;
  };
  publication: {
    commit(movie: CommittedMovie): void;
    roots: readonly Pick<MediaRoot, "id" | "hostPath">[];
    identity: Pick<MaintenanceMovieGroup, "movieId" | "assets">;
  };
  signal?: AbortSignal;
}

export interface MaintenanceRuntimeApplyLibraryEntryInput
  extends Omit<MaintenanceRuntimeApplyEntryInput, "entry" | "files"> {
  root: MediaRoot;
  entry: LibraryEntryRecord;
  localState?: NfoLocalState;
  /** Where moving presets organize the movie. */
  target?: PublicationTarget;
}

/** Writing presets keep files and metadata where they are; only the default NFO name comes from this. */
const IN_PLACE_TARGET: PublicationTarget = {
  placement: "inPlace",
  outputPath: "",
  folderTemplate: "",
  fileTemplate: "",
};

export interface MaintenanceRuntimeApplySuccess {
  status: "success";
  crawlerData?: CrawlerData;
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
    private readonly target?: PublicationTarget,
    readonly inventory = new DirectoryInventory(),
  ) {}

  async getConfiguration(): Promise<Configuration> {
    return structuredClone(await this.deps.config.get());
  }

  async createSession(input: {
    inventory: DirectoryInventory;
    configuration?: Configuration;
    root: MediaRoot;
    target?: PublicationTarget;
    signal?: AbortSignal;
  }): Promise<MaintenanceRuntime> {
    const config = structuredClone(input.configuration ?? (await this.getConfiguration()));
    return new MaintenanceRuntime(
      {
        ...this.deps,
        aggregationService:
          this.deps.aggregationService ??
          (this.deps.crawlerProvider
            ? new AggregationService(this.deps.crawlerProvider, {
                config,
                logger: this.deps.logger,
                signal: input.signal,
                recordSiteResults: this.deps.recordSiteResults,
              })
            : undefined),
        config: { get: async () => config },
      },
      input.target,
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
    registeredOutputs?: Map<string, { nfoPaths: string[] }>;
  }): Promise<LocalScanEntry[]> {
    const config = await this.getPresetConfig("import_local");
    const filePaths = input.refs.map((ref) => resolveRootRelativePath(input.root, ref.relativePath));
    return await this.localScanService.scanFiles(input.root, filePaths, config.paths.sceneImagesFolder, input.signal, {
      registeredOutputs: input.registeredOutputs,
      inventory: this.inventory,
      filenameRules: config.scrape,
    });
  }

  async previewMovie(input: MaintenanceRuntimePreviewMovieInput): Promise<MaintenanceRuntimePreviewItem> {
    const preset = getMaintenancePreset(input.presetId);
    const config = await this.getPresetConfig(input.presetId);
    const { entry, files, signal } = input;
    try {
      throwIfAborted(signal);

      if (preset.dataSource === "local" && entry.scanError) {
        throw new Error(entry.scanError);
      }

      let crawlerData: CrawlerData | undefined;
      let imageAlternatives: MaintenanceImageAlternatives = {};
      const published = { crawlerData: entry.crawlerData, localState: entry.nfoLocalState };
      const { translateService } = this.deps;
      if (preset.dataSource === "online") {
        if (!this.deps.aggregationService || !translateService) {
          throw new Error("Online preset lacks required aggregation or translation services");
        }
        // A manual-URL fix pinned its detail page; refreshing by number would undo it.
        const pin = entry.nfoLocalState?.sourcePin;
        const caseId = this.deps.prepareScrapeItem?.({
          fileInfo: entry.fileInfo,
          caseId: undefined as string | undefined,
        }).caseId;
        const { aggregationService } = this.deps;
        const prepared = await runWithScrapeItem(
          { caseId, execution: {} },
          async () =>
            await prepareOnlineMetadata({
              number: entry.fileInfo.number,
              configuration: config,
              aggregationService,
              translateService,
              published,
              keepEdits: false,
              manualScrape: pin ? { site: pin.site, detailUrl: pin.url } : undefined,
              signal,
            }),
        );
        crawlerData = prepared.crawlerData;
        imageAlternatives = prepared.aggregation.imageAlternatives;
      } else if (preset.dataSource === "stored") {
        if (!this.deps.loadSiteResults || !translateService) {
          throw new Error("Stored preset lacks site result storage or translation services");
        }
        // A pinned movie re-merges only what its pinned page returned; a number search may describe another work.
        const pin = entry.nfoLocalState?.sourcePin;
        const siteData = new Map(
          (await this.deps.loadSiteResults(entry.fileInfo.number)).flatMap(({ site, data, sourceUrl }) =>
            data && (!pin || (site === pin.site && sourceUrl === pin.url))
              ? [[site as Website, data as CrawlerData] as const]
              : [],
          ),
        );
        if (siteData.size === 0) {
          throw new Error(
            pin
              ? `No stored result from the pinned page ${pin.url}; refresh it online`
              : `No stored site results for ${entry.fileInfo.number}`,
          );
        }
        const merged = mergeSiteData(siteData, config);
        imageAlternatives = merged.imageAlternatives;
        const publication = await publishMetadata({
          // Actor photos are output, not site data; re-merging must not fetch them again.
          data: { ...merged.data, actor_profiles: entry.crawlerData?.actor_profiles },
          published,
          keepEdits: false,
          configuration: config,
          translateService,
          signal,
        });
        crawlerData = publication.data;
      } else {
        crawlerData = entry.crawlerData && canonicalizeCrawlerDataActorAliases(entry.crawlerData, config);
        if (!crawlerData && preset.output === "none") {
          crawlerData = {
            title: entry.fileInfo.fileName,
            number: entry.fileInfo.number,
            actors: [],
            genres: [],
            scene_images: [],
          };
        }
      }

      const { fieldDiffs, unchangedFieldDiffs } = this.partitionDiffs(entry, preset, crawlerData, imageAlternatives);

      const { pathDiff, affectedFiles } = await this.previewPaths({
        presetId: input.presetId,
        entry,
        files,
        crawlerData,
        signal,
      });

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

  async previewPaths(input: MaintenanceRuntimePreviewPathsInput): Promise<{
    pathDiff?: PathDiff;
    affectedFiles: Array<{ fileId: string; currentPath: string; targetPath: string }>;
  }> {
    const preset = getMaintenancePreset(input.presetId);
    const config = await this.getPresetConfig(input.presetId);
    const failed = preset.dataSource === "local" ? input.files.find((file) => file.scanError) : undefined;
    if (failed?.scanError) throw new Error(failed.scanError);
    const plans = await this.buildPlans(input.files, config, preset, input.crawlerData, input.signal);
    return {
      pathDiff: plans[this.memberIndex(input.files, input.entry)].pathDiff,
      affectedFiles: input.files.map((file, index) => ({
        fileId: file.fileId,
        currentPath: file.fileInfo.filePath,
        targetPath:
          preset.output === "move" && plans[index].plan ? plans[index].plan.targetVideoPath : file.fileInfo.filePath,
      })),
    };
  }

  async applyLibraryEntry(input: MaintenanceRuntimeApplyLibraryEntryInput): Promise<MaintenanceRuntimeApplyResult> {
    const libraryEntry = input.entry;
    const roots = new Map(input.publication.roots.map((root) => [root.id, root]));
    const resolveRoot = async (id: string) => {
      const root = roots.get(id);
      if (!root) throw new Error(`Publication root not found: ${id}`);
      return root;
    };
    const locations = await registeredMediaLocations(libraryEntry, resolveRoot);
    // Each confirmation rewrites the files it touches, so no later action may reuse this one's observations.
    const runtime = await this.createSession({
      inventory: new DirectoryInventory(),
      root: input.root,
      target: input.target,
      signal: input.signal,
    });
    const files: LocalScanEntry[] = [];
    const storedData = libraryEntry.crawlerDataJson
      ? (JSON.parse(libraryEntry.crawlerDataJson) as CrawlerData)
      : undefined;
    for (const rootId of new Set(libraryEntry.files.map((file) => file.rootId))) {
      const root = await resolveRoot(rootId);
      const records = libraryEntry.files.filter((file) => file.rootId === rootId);
      const scanned = await runtime.scanRefs({
        root: { ...input.root, ...root },
        refs: records.map((file) => ({ relativePath: file.rootRelativePath })),
        registeredOutputs: locations,
        signal: input.signal,
      });
      for (const record of records) {
        const file = scanned.find((candidate) => candidate.ref.relativePath === record.rootRelativePath);
        if (!file) throw new Error(`Maintenance scan omitted library file: ${record.id}`);
        files.push({
          ...file,
          fileId: record.id,
          crawlerData: file.crawlerData ?? storedData,
          nfoLocalState: { ...file.nfoLocalState, ...input.localState },
        });
      }
    }
    if (!files.length) throw new Error("Library movie has no media files");
    return runtime.applyEntry({ ...input, entry: files[0], files });
  }

  async applyEntry(input: MaintenanceRuntimeApplyEntryInput): Promise<MaintenanceRuntimeApplyResult> {
    const preset = getMaintenancePreset(input.presetId);
    const { entry, files = [entry], committed, publication, signal } = input;
    const config = await this.getPresetConfig(input.presetId);
    throwIfAborted(signal);

    const crawlerData = committed?.crawlerData ?? entry.crawlerData;
    if (!crawlerData) throw new Error("Maintenance output requires movie metadata");

    const plans = await this.buildPlans(files, config, preset, crawlerData, signal);
    const sharedPlan = plans[this.memberIndex(files, entry)];
    const members = await Promise.all(
      files.map(async (file, index) => {
        const layout = plans[index].plan;
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
          throw new Error("Online preset lacks download service");
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
          existingAssets: entry.assets,
          inventory: this.inventory,
          sources: undefined,
          callbacks: {
            signal,
            assetDecisions: committed?.assetDecisions,
            forceReplace: {
              thumb: committed?.assetDecisions?.thumb === "replace",
              poster: committed?.assetDecisions?.poster === "replace",
              fanart: committed?.assetDecisions?.fanart === "replace",
            },
          },
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
        relocateExistingArtifacts: input.presetId === "local_organize",
        ownedAssetPaths: await Promise.all(
          publication.identity.assets
            .filter((asset) => asset.published && MANAGED_MOVIE_ASSET_KINDS.has(asset.kind))
            .map(async (asset) => {
              const root = publication.roots.find((root) => root.id === asset.rootId);
              if (!root) throw new Error(`Publication root not found: ${asset.rootId}`);
              return resolveRootRelativePath(root, asset.relativePath);
            }),
        ),
        nfoNaming: config.download.nfoNaming,
        writeNfo: async (assets, writeFile) =>
          preset.output === "none"
            ? entry.nfoPath
            : await writePreparedNfo({
                assets,
                config,
                crawlerData: preparedCrawlerData,
                enabled: Boolean((preset.dataSource !== "local" || config.download.generateNfo) && sharedPlan.plan),
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

      if (!published.files.some((candidate) => candidate.fileId === entry.fileId))
        throw new Error("Maintenance publication requires the selected media member");
      if (preset.output === "none" && (published.moves.length || published.artifacts.length))
        throw new Error("Importing local metadata must not change files");

      const movieAssets = [...published.movieAssets];
      if (preset.output === "none") {
        // The shared layout keeps one NFO and image set per directory; import must also own every other member's set.
        const registered = new Set(
          movieAssets.flatMap((asset) =>
            asset.type === "local" ? [`${asset.kind}\0${asset.file.rootId}\0${asset.file.relativePath}`] : [],
          ),
        );
        for (const file of files) {
          for (const [kind, paths] of [
            ["nfo", file.nfoPaths],
            ["thumb", [file.assets.thumb]],
            ["poster", [file.assets.poster]],
            ["fanart", [file.assets.fanart]],
            ["trailer", [file.assets.trailer]],
            ["scene", file.assets.sceneImages],
            ["actor", file.assets.actorPhotos],
          ] as const) {
            for (const path of paths) {
              if (!path) continue;
              const ref = toRootFileRef(path, publication.roots);
              const key = `${kind}\0${ref.rootId}\0${ref.relativePath}`;
              if (registered.has(key)) continue;
              registered.add(key);
              movieAssets.push({ type: "local", kind, file: ref });
            }
          }
        }
      }
      const movie = toCommittedMovie(
        {
          ...published,
          movieId: publication.identity.movieId,
          movieAssets,
          // Imported NFOs and images become MDCz-owned so later refreshes may rewrite them.
          publishedTargets:
            preset.output === "none"
              ? movieAssets.flatMap((asset) =>
                  asset.type === "local" && MANAGED_MOVIE_ASSET_KINDS.has(asset.kind) ? [asset.file] : [],
                )
              : published.publishedTargets,
        },
        { crawlerData: preparedCrawlerData, sources: undefined },
      );

      const unlock = await acquireOutputDirectories(
        [
          ...published.moves.map((move) => move.targetPath),
          ...published.artifacts.map((artifact) => artifact.targetPath),
        ],
        (directory) => this.inventory.canonicalDirectory(directory),
      );
      try {
        throwIfAborted(signal);
        const validate = async () => {
          throwIfAborted(signal);
          await this.inventory.assertUnchanged(files.flatMap((f) => f.nfoPaths));
          throwIfAborted(signal);
        };
        const commit = () => publication.commit(movie);
        if (published.moves.length) {
          await new MoveOutput(undefined, this.deps.logger).install({
            reorganize: true,
            moves: published.moves,
            artifacts: published.artifacts,
            protectedMediaFiles: published.protectedMediaFiles,
            validate,
            commit,
          });
        } else {
          await new WriteOutput(undefined, this.deps.logger).install(published.artifacts, {
            protectedMediaFiles: published.protectedMediaFiles,
            validate,
            commit,
          });
        }
      } finally {
        unlock();
      }

      return {
        status: "success",
        crawlerData: preparedCrawlerData,
        output: published,
        error: null,
      };
    } catch (error) {
      if (isAbortError(error) || error instanceof PublicationConflictError || publication === undefined) throw error;
      return { status: "failed", error: toErrorMessage(error) };
    } finally {
      if (stagingDir) {
        try {
          await rm(stagingDir, { recursive: true, force: true });
        } catch (error) {
          (this.deps.logger ?? runtimeLoggerService.getLogger("MaintenanceRuntime")).warn(
            `Failed to remove maintenance staging ${stagingDir}: ${toErrorMessage(error)}`,
          );
        }
      }
    }
  }

  private memberIndex(files: readonly LocalScanEntry[], entry: LocalScanEntry): number {
    const index = files.findIndex((file) => file.fileInfo.filePath === entry.fileInfo.filePath);
    if (index < 0) throw new Error(`Maintenance movie does not contain the selected file: ${entry.fileInfo.filePath}`);
    return index;
  }

  private async buildPlans(
    files: readonly LocalScanEntry[],
    config: Configuration,
    preset: MaintenancePreset,
    crawlerData: CrawlerData | undefined,
    signal?: AbortSignal,
  ): Promise<Array<{ plan?: ResolvedPublicationLayout; pathDiff?: PathDiff }>> {
    const labels =
      preset.output === "move" && crawlerData
        ? assignVersionLabels(
            await Promise.all(
              files.map(async (file) => ({
                sourcePath: file.fileInfo.filePath,
                targetVideoPath: this.planMove(file, config, crawlerData).targetVideoPath,
                multipart: Boolean(file.fileInfo.part),
                filenameResolution: file.fileInfo.resolution,
                size: (await this.inventory.stats(file.fileInfo.filePath)).size,
              })),
            ),
          )
        : [];
    return await Promise.all(
      files.map((file, index) => this.buildPlan(file, config, preset, crawlerData, signal, labels[index])),
    );
  }

  // Organizing moves files already in the library, whatever transfer first placed them there.
  private planMove(entry: LocalScanEntry, config: Configuration, crawlerData: CrawlerData, versionLabel?: string) {
    if (!this.target) throw new Error("Organizing needs a library to organize into");
    return this.deps.fileOrganizer.plan(
      entry.fileInfo,
      crawlerData,
      config,
      { ...this.target, placement: "move" },
      entry.nfoLocalState,
      { versionLabel },
    );
  }

  private async buildPlan(
    entry: LocalScanEntry,
    config: Configuration,
    preset: MaintenancePreset,
    crawlerData: CrawlerData | undefined,
    signal?: AbortSignal,
    versionLabel?: string,
  ): Promise<{
    plan?: ResolvedPublicationLayout;
    pathDiff?: PathDiff;
  }> {
    throwIfAborted(signal);

    if (!crawlerData) {
      throw new Error("Local NFO does not exist or failed to parse; cannot proceed with subsequent steps");
    }

    if (preset.output !== "move") {
      const layout = this.deps.fileOrganizer.plan(
        entry.fileInfo,
        crawlerData,
        config,
        IN_PLACE_TARGET,
        entry.nfoLocalState,
      );
      const metadataDir = entry.nfoPath ? dirname(entry.nfoPath) : layout.metadataDir;
      return {
        plan: await this.deps.fileOrganizer.resolveOutputPlan(
          {
            outputDir: entry.currentDir,
            metadataDir,
            mode: "preserve",
            targetVideoPath: entry.fileInfo.filePath,
            nfoPath:
              entry.nfoPath && !isMovieNfoBaseName(basename(entry.nfoPath, ".nfo"))
                ? entry.nfoPath
                : join(metadataDir, basename(layout.nfoPath)),
            renameSubtitles: false,
          },
          entry.fileInfo.filePath,
          {
            allowSharedDirectory: true,
            existingMetadataDir: entry.nfoPath ? dirname(entry.nfoPath) : entry.currentDir,
            inventory: this.inventory,
          },
        ),
        pathDiff: undefined,
      };
    }

    const plan = await this.deps.fileOrganizer.resolveOutputPlan(
      this.planMove(entry, config, crawlerData, versionLabel),
      entry.fileInfo.filePath,
      {
        allowSharedDirectory:
          config.naming.assetNamingMode === "followVideo" && config.download.nfoNaming === "filename",
        existingMetadataDir: entry.nfoPath ? dirname(entry.nfoPath) : entry.currentDir,
        inventory: this.inventory,
      },
    );

    return {
      plan,
      pathDiff: diffPaths(entry, plan),
    };
  }

  private partitionDiffs(
    entry: LocalScanEntry,
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
      entry,
      imageAlternatives,
      userEdited: editedKeys(entry.nfoLocalState),
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
