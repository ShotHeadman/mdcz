import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import type { MaintenanceMovieGroup } from "@mdcz/shared/maintenanceTasks";
import type {
  CrawlerData,
  FieldDiff,
  LocalScanEntry,
  MaintenanceImageAlternatives,
  MaintenancePresetId,
  MaintenancePreviewStatus,
  PathDiff,
} from "@mdcz/shared/types";
import type { CommittedMovie } from "../publication/committedMovie";
import type { PublicationJournalPort } from "../publication/types";
import {
  type AggregationService,
  applyScrapeNetworkPolicy,
  type DownloadManager,
  type FileOrganizer,
  type NfoGenerator,
  type ScrapeNetworkPolicyClient,
  type TranslateService,
} from "../scrape";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "../scrape/actorOutput";
import { DirectoryInventory } from "../scrape/DirectoryInventory";
import { LocalScanService } from "./LocalScanService";
import {
  MaintenanceFileScraper,
  type MaintenanceFileScraperDependencies,
  type MaintenanceSignalService,
} from "./MaintenanceFileScraper";
import { getMaintenancePreset, supportsMaintenanceExecution } from "./presets";

export interface MaintenanceRuntimeConfigProvider {
  get(): Promise<Configuration>;
}

export interface MaintenanceRuntimeDependencies {
  actorImageService: RuntimeActorImageService;
  actorSourceProvider?: RuntimeActorSourceProvider;
  aggregationService: AggregationService;
  config: MaintenanceRuntimeConfigProvider;
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  /**
   * All HTTP-owning maintenance dependencies must share this client. It is
   * configured from the current scrape policy before preview or apply work.
   */
  networkPolicyClient?: ScrapeNetworkPolicyClient;
  nfoGenerator: NfoGenerator;
  signalService: MaintenanceSignalService;
  translateService: TranslateService;
  postProcessAssets?: MaintenanceFileScraperDependencies["postProcessAssets"];
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
    const configuration = structuredClone(await this.deps.config.get());
    if (configuration.behavior.metadataOnly) {
      throw new Error("维护模式不支持仅输出元数据，请先在设置中关闭");
    }
    return configuration;
  }

  async createSession(input: {
    inventory: DirectoryInventory;
    configuration?: Configuration;
    root: MediaRoot;
    outputRoot: MediaRoot;
    outputRelativeDirectory: string;
  }): Promise<MaintenanceRuntime> {
    const config = structuredClone(input.configuration ?? (await this.getConfiguration()));
    if (config.behavior.metadataOnly) {
      throw new Error("维护模式不支持仅输出元数据，请先在设置中关闭");
    }
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

  /** Applies the current per-site scrape policy to maintenance HTTP work. */
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

    const scraper = new MaintenanceFileScraper(this.createFileScraperDependencies(), preset);
    const entry = input.entry;
    const preview = await scraper.previewFile(entry, config, input.signal, input.files);
    return {
      entry,
      rootId: input.root.id,
      relativePath: this.toRelativePath(input.root, entry.fileInfo.filePath),
      status: preview.status,
      error: preview.error ?? null,
      fieldDiffs: preview.fieldDiffs ?? [],
      unchangedFieldDiffs: preview.unchangedFieldDiffs ?? [],
      pathDiff: preview.pathDiff ?? null,
      proposedCrawlerData: preview.proposedCrawlerData ?? null,
      imageAlternatives: preview.imageAlternatives,
      affectedFiles: preview.affectedFiles,
      files: input.files,
    };
  }

  async applyEntry(input: MaintenanceRuntimeApplyEntryInput): Promise<MaintenanceRuntimeApplyResult> {
    const preset = getMaintenancePreset(input.presetId);
    if (!supportsMaintenanceExecution(preset))
      throw new Error(`Maintenance preset ${preset.id} does not support execution`);

    const entry = input.entry;
    const config = await this.getPresetConfig(input.presetId);
    const scraper = new MaintenanceFileScraper(this.createFileScraperDependencies(input.signalService), preset);
    const result = await scraper.processFile(
      entry,
      config,
      input.progress ?? { fileIndex: 1, totalFiles: 1 },
      input.signal,
      input.committed,
      input.files,
      input.publication,
    );

    if (result.status !== "success") {
      return { status: "failed", error: result.error ?? "维护应用失败" };
    }

    const updatedEntry = result.updatedEntry ?? entry;
    if (!result.outputRelativePath) throw new Error("Maintenance publication requires the selected media member");
    return {
      status: "success",
      entry: updatedEntry,
      crawlerData: result.crawlerData,
      fieldDiffs: result.fieldDiffs,
      unchangedFieldDiffs: result.unchangedFieldDiffs,
      pathDiff: result.pathDiff,
      outputRelativePath: result.outputRelativePath,
      outputSize: result.outputSize,
      outputModifiedAt: result.outputModifiedAt,
      error: result.error,
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

  private createFileScraperDependencies(signalService?: MaintenanceSignalService): MaintenanceFileScraperDependencies {
    return {
      inventory: this.inventory,
      outputTemplateRoot: this.outputTemplateRoot,
      actorImageService: this.deps.actorImageService,
      actorSourceProvider: this.deps.actorSourceProvider,
      aggregationService: this.deps.aggregationService,
      downloadManager: this.deps.downloadManager,
      fileOrganizer: this.deps.fileOrganizer,
      nfoGenerator: this.deps.nfoGenerator,
      signalService: signalService ?? this.deps.signalService,
      translateService: this.deps.translateService,
      postProcessAssets: this.deps.postProcessAssets,
    };
  }

  private async getPresetConfig(presetId: MaintenancePresetId): Promise<Configuration> {
    const preset = getMaintenancePreset(presetId);
    const baseConfig = await this.getConfiguration();
    return mergeDeep(baseConfig, preset.configOverrides);
  }
}
