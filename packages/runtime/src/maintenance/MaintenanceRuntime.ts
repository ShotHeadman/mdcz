import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import type {
  CrawlerData,
  FieldDiff,
  LocalScanEntry,
  MaintenanceImageAlternatives,
  MaintenancePresetId,
  PathDiff,
} from "@mdcz/shared/types";
import type { MediaRoot } from "@mdcz/storage";
import { resolveRootRelativePath, toRootRelativePath } from "@mdcz/storage";
import type { AggregationService, DownloadManager, FileOrganizer, NfoGenerator, TranslateService } from "../scrape";
import type { RuntimeActorImageService } from "../scrape/actorOutput";
import { buildCommittedCrawlerData, type MaintenanceFieldSelectionSide } from "./commit";
import { LocalScanService } from "./LocalScanService";
import { MaintenanceFileScraper, type MaintenanceFileScraperDependencies } from "./MaintenanceFileScraper";
import type { MaintenanceSignalService } from "./output";
import { getMaintenancePreset, supportsMaintenanceExecution } from "./presets";

export interface MaintenanceRuntimeConfigProvider {
  get(): Promise<Configuration>;
}

export interface MaintenanceRuntimeDependencies {
  actorImageService: RuntimeActorImageService;
  actorSourceProvider?: unknown;
  aggregationService: AggregationService;
  config: MaintenanceRuntimeConfigProvider;
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  nfoGenerator: NfoGenerator;
  signalService: MaintenanceSignalService;
  translateService: TranslateService;
  useRootHostPathAsMediaPath?: boolean;
}

export interface MaintenanceRuntimePreviewInput {
  root: MediaRoot;
  presetId: MaintenancePresetId;
  refs?: Array<{ relativePath: string }>;
  signal?: AbortSignal;
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
  status: "ready" | "blocked";
  error: string | null;
  fieldDiffs: FieldDiff[];
  unchangedFieldDiffs: FieldDiff[];
  pathDiff: PathDiff | null;
  proposedCrawlerData: CrawlerData | null;
  imageAlternatives?: MaintenanceImageAlternatives;
}

export interface MaintenanceRuntimeApplyInput {
  root: MediaRoot;
  presetId: MaintenancePresetId;
  preview: {
    relativePath: string;
    proposedCrawlerData: CrawlerData | null;
    fieldDiffs?: FieldDiff[];
    fieldSelections?: Record<string, MaintenanceFieldSelectionSide>;
    imageAlternatives?: MaintenanceImageAlternatives;
  };
  signal?: AbortSignal;
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

  async scan(input: { root: MediaRoot; signal?: AbortSignal }): Promise<LocalScanEntry[]> {
    const config = await this.getPresetConfig("read_local", input.root);
    return await this.localScanService.scan(input.root.hostPath, config.paths.sceneImagesFolder, input.signal);
  }

  async scanRefs(input: {
    root: MediaRoot;
    refs: Array<{ relativePath: string }>;
    signal?: AbortSignal;
  }): Promise<LocalScanEntry[]> {
    const config = await this.getPresetConfig("read_local", input.root);
    const filePaths = input.refs.map((ref) => resolveRootRelativePath(input.root, ref.relativePath));
    return await this.localScanService.scanFiles(filePaths, config.paths.sceneImagesFolder, input.signal);
  }

  async scanFilePaths(input: {
    filePaths: string[];
    sceneImagesFolder?: string;
    signal?: AbortSignal;
  }): Promise<LocalScanEntry[]> {
    const config = await this.deps.config.get();
    return await this.localScanService.scanFiles(
      input.filePaths,
      input.sceneImagesFolder ?? config.paths.sceneImagesFolder,
      input.signal,
    );
  }

  async preview(input: MaintenanceRuntimePreviewInput): Promise<MaintenanceRuntimePreviewItem[]> {
    const entries = input.refs?.length
      ? await this.scanRefs({ root: input.root, refs: input.refs, signal: input.signal })
      : await this.scan({ root: input.root, signal: input.signal });

    return await this.previewEntries({ ...input, entries });
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

  async apply(input: MaintenanceRuntimeApplyInput): Promise<MaintenanceRuntimeApplyResult> {
    const preset = getMaintenancePreset(input.presetId);
    if (!supportsMaintenanceExecution(preset)) {
      return {
        status: "success",
        entry: (await this.scanRefs({ root: input.root, refs: [input.preview] }))[0],
        outputRelativePath: input.preview.relativePath,
      };
    }

    const entries = await this.scanRefs({ root: input.root, refs: [input.preview], signal: input.signal });
    const entry = entries[0];
    if (!entry) {
      return { status: "failed", error: `维护文件不存在：${input.preview.relativePath}` };
    }

    return await this.applyEntry({
      root: input.root,
      presetId: input.presetId,
      entry,
      committed: {
        fieldDiffs: input.preview.fieldDiffs,
        fieldSelections: input.preview.fieldSelections,
        imageAlternatives: input.preview.imageAlternatives,
        crawlerData: input.preview.proposedCrawlerData ?? undefined,
      },
      signal: input.signal,
    });
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
    const scraper = new MaintenanceFileScraper(this.createFileScraperDependencies(), preset);
    const committedCrawlerData = buildCommittedCrawlerData(
      entry,
      {
        fileId: entry.fileId,
        status: "ready",
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
    return {
      status: "success",
      entry: updatedEntry,
      crawlerData: result.crawlerData,
      fieldDiffs: result.fieldDiffs,
      unchangedFieldDiffs: result.unchangedFieldDiffs,
      pathDiff: result.pathDiff,
      outputRelativePath: this.toRelativePath(input.root, updatedEntry.fileInfo.filePath),
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

  private createFileScraperDependencies(): MaintenanceFileScraperDependencies {
    return {
      actorImageService: this.deps.actorImageService,
      actorSourceProvider: this.deps.actorSourceProvider,
      aggregationService: this.deps.aggregationService,
      downloadManager: this.deps.downloadManager,
      fileOrganizer: this.deps.fileOrganizer,
      nfoGenerator: this.deps.nfoGenerator,
      signalService: this.deps.signalService ?? emptySignalService,
      translateService: this.deps.translateService,
    };
  }

  private async getPresetConfig(presetId: MaintenancePresetId, root: MediaRoot): Promise<Configuration> {
    const preset = getMaintenancePreset(presetId);
    const baseConfig = await this.deps.config.get();
    const mediaPath = this.deps.useRootHostPathAsMediaPath === false ? baseConfig.paths.mediaPath : root.hostPath;
    return mergeDeep(
      {
        ...baseConfig,
        paths: {
          ...baseConfig.paths,
          mediaPath,
        },
      },
      preset.configOverrides,
    );
  }
}
