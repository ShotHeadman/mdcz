import type { MediaRoot } from "@mdcz/media-store";
import { isPathInside, resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import type {
  CrawlerData,
  FieldDiff,
  LocalScanEntry,
  MaintenanceImageAlternatives,
  MaintenancePresetId,
  MaintenancePreviewStatus,
  PathDiff,
} from "@mdcz/shared/types";
import type { PreparedPublicationPlan } from "../publication";
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
import { LocalScanService } from "./LocalScanService";
import {
  MaintenanceFileScraper,
  type MaintenanceFileScraperDependencies,
  type MaintenanceSignalService,
} from "./MaintenanceFileScraper";
import type { CommittedMaintenanceFile } from "./MaintenancePreparationService";
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

export interface MaintenanceRuntimePreviewEntriesInput {
  root: MediaRoot;
  presetId: MaintenancePresetId;
  entries: LocalScanEntry[];
  sharedData?: CommittedMaintenanceFile;
  signal?: AbortSignal;
}

export interface MaintenanceRuntimePreviewItem {
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
  plan?: PreparedPublicationPlan;
  release?: () => Promise<void>;
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
  ) {}

  async getConfiguration(): Promise<Configuration> {
    const configuration = structuredClone(await this.deps.config.get());
    if (configuration.behavior.metadataOnly) {
      throw new Error("维护模式不支持仅输出元数据，请先在设置中关闭");
    }
    return configuration;
  }

  async createSession(input: {
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
    config.paths.mediaPath = isPathInside(sourceMediaPath, outputBaseDirectory)
      ? sourceMediaPath
      : input.outputRoot.hostPath;
    config.paths.successOutputFolder = outputBaseDirectory;
    return new MaintenanceRuntime({ ...this.deps, config: { get: async () => config } }, sourceMediaPath);
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
    const config = await this.getPresetConfig("read_local", input.root);
    const filePaths = input.refs.map((ref) => resolveRootRelativePath(input.root, ref.relativePath));
    return await this.localScanService.scanFiles(input.root, filePaths, config.paths.sceneImagesFolder, input.signal, {
      mediaPath: this.sourceMediaPath ?? config.paths.mediaPath,
      metadataPath: "",
      registeredOutputs: input.registeredOutputs,
    });
  }

  async previewEntries(input: MaintenanceRuntimePreviewEntriesInput): Promise<MaintenanceRuntimePreviewItem[]> {
    const preset = getMaintenancePreset(input.presetId);
    const config = await this.getPresetConfig(input.presetId, input.root);
    const entries = input.entries;

    if (!supportsMaintenanceExecution(preset)) {
      return entries.map((entry) => this.localEntryToPreviewItem(input.root, entry));
    }

    const scraper = new MaintenanceFileScraper(this.createFileScraperDependencies(), preset);
    const items: MaintenanceRuntimePreviewItem[] = [];
    for (const entry of entries) {
      const relativePath = this.toRelativePath(input.root, entry.fileInfo.filePath);
      const preview = await scraper.previewFile(entry, config, input.signal, input.sharedData);
      items.push({
        entry,
        rootId: input.root.id,
        relativePath,
        status: preview.status,
        error: preview.error ?? null,
        fieldDiffs: preview.fieldDiffs ?? [],
        unchangedFieldDiffs: preview.unchangedFieldDiffs ?? [],
        pathDiff: preview.pathDiff ?? null,
        proposedCrawlerData: preview.proposedCrawlerData ?? null,
        imageAlternatives: preview.imageAlternatives,
      });
    }

    items.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
    return items;
  }

  async applyEntry(input: MaintenanceRuntimeApplyEntryInput): Promise<MaintenanceRuntimeApplyResult> {
    const preset = getMaintenancePreset(input.presetId);
    if (!supportsMaintenanceExecution(preset)) {
      return {
        status: "success",
        entry: input.entry,
        outputRelativePath: this.toRelativePath(input.root, input.entry.fileInfo.filePath),
      };
    }

    const entry = input.entry;
    const config = await this.getPresetConfig(input.presetId, input.root);
    const scraper = new MaintenanceFileScraper(this.createFileScraperDependencies(input.signalService), preset);
    const result = await scraper.processFile(
      entry,
      config,
      input.progress ?? { fileIndex: 1, totalFiles: 1 },
      input.signal,
      input.committed,
      input.files,
    );

    if (result.status !== "success") {
      return { status: "failed", error: result.error ?? "维护应用失败" };
    }

    const updatedEntry = result.updatedEntry ?? entry;
    const plan = result.publicationPlan;
    if (!plan) {
      return { status: "failed", error: "维护应用未生成发布计划" };
    }
    return {
      status: "success",
      entry: updatedEntry,
      crawlerData: result.crawlerData,
      fieldDiffs: result.fieldDiffs,
      unchangedFieldDiffs: result.unchangedFieldDiffs,
      pathDiff: result.pathDiff,
      outputRelativePath: this.toRelativePath(input.root, updatedEntry.fileInfo.filePath),
      plan,
      release: result.release,
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

  private async getPresetConfig(presetId: MaintenancePresetId, root: MediaRoot): Promise<Configuration> {
    const preset = getMaintenancePreset(presetId);
    const baseConfig = await this.getConfiguration();
    return mergeDeep(
      {
        ...baseConfig,
        paths: {
          ...baseConfig.paths,
          mediaPath: baseConfig.paths.mediaPath.trim() || root.hostPath,
        },
      },
      preset.configOverrides,
    );
  }
}
