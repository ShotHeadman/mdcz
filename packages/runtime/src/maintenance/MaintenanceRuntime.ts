import type { MediaRoot } from "@mdcz/media-store";
import { resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import type { MaintenanceFieldSelectionSide } from "@mdcz/shared/maintenanceTasks";
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
import { buildCommittedCrawlerData } from "./applyData";
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
}

export interface MaintenanceRuntimePreviewEntriesInput {
  root: MediaRoot;
  presetId: MaintenancePresetId;
  entries: LocalScanEntry[];
  signal?: AbortSignal;
}

export interface MaintenanceRuntimePreviewItem {
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
  committed?: {
    crawlerData?: CrawlerData;
    fieldDiffs?: FieldDiff[];
    fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
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

const emptySignalService: MaintenanceSignalService = {
  setProgress: () => undefined,
  showLogText: () => undefined,
};

export class MaintenanceRuntime {
  private readonly localScanService = new LocalScanService();

  constructor(private readonly deps: MaintenanceRuntimeDependencies) {}

  /** Applies the current per-site scrape policy to maintenance HTTP work. */
  async applyNetworkPolicy(): Promise<void> {
    if (!this.deps.networkPolicyClient) return;
    applyScrapeNetworkPolicy(this.deps.networkPolicyClient, await this.deps.config.get());
  }

  async scanRefs(input: {
    root: MediaRoot;
    refs: Array<{ relativePath: string }>;
    signal?: AbortSignal;
  }): Promise<LocalScanEntry[]> {
    const config = await this.getPresetConfig("read_local", input.root);
    const filePaths = input.refs.map((ref) => resolveRootRelativePath(input.root, ref.relativePath));
    return await this.localScanService.scanFiles(input.root, filePaths, config.paths.sceneImagesFolder, input.signal);
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
      const preview = await scraper.previewFile(entry, config, input.signal);
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
    const committedCrawlerData =
      input.committed?.crawlerData && input.committed.fieldDiffs === undefined
        ? input.committed.crawlerData
        : buildCommittedCrawlerData(
            entry,
            {
              fieldDiffs: input.committed?.fieldDiffs ?? [],
              proposedCrawlerData: input.committed?.crawlerData,
              imageAlternatives: input.committed?.imageAlternatives,
            },
            input.committed?.fieldSelections,
          );
    const result = await scraper.processFile(
      entry,
      config,
      input.progress ?? { fileIndex: 1, totalFiles: 1 },
      input.signal,
      {
        crawlerData: committedCrawlerData,
        imageAlternatives: input.committed?.imageAlternatives,
        assetDecisions: input.committed?.assetDecisions,
      },
    );

    if (result.status !== "success") {
      return { status: "failed", error: result.error ?? "维护应用失败" };
    }

    const updatedEntry = result.updatedEntry ?? entry;
    const plan = result.publicationPlan;
    if (!plan && supportsMaintenanceExecution(preset)) {
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
      signalService: signalService ?? this.deps.signalService ?? emptySignalService,
      translateService: this.deps.translateService,
    };
  }

  private async getPresetConfig(presetId: MaintenancePresetId, root: MediaRoot): Promise<Configuration> {
    const preset = getMaintenancePreset(presetId);
    const baseConfig = await this.deps.config.get();
    return mergeDeep(
      {
        ...baseConfig,
        paths: {
          ...baseConfig.paths,
          mediaPath: root.hostPath,
        },
      },
      preset.configOverrides,
    );
  }
}
