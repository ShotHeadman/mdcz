import type { Configuration } from "@main/services/config/models";
import { loggerService } from "@main/services/LoggerService";
import type { SignalService } from "@main/services/SignalService";
import { toErrorMessage } from "@main/utils/common";
import type { FileOrganizer, OrganizePlan, TranslateService } from "@mdcz/runtime/scrape";
import type {
  CrawlerData,
  FieldDiff,
  LocalScanEntry,
  MaintenanceCommitItem,
  MaintenanceImageAlternatives,
  PathDiff,
} from "@mdcz/shared/types";
import { isAbortError, throwIfAborted } from "../abort";
import type { AggregationService } from "../aggregation";
import type { SourceMap } from "../aggregation/types";
import { partitionCrawlerDataWithOptions } from "./diffCrawlerData";
import { diffPaths } from "./diffPaths";
import type { MaintenancePreset } from "./presets";

export interface PreparedMaintenanceFile {
  crawlerData?: CrawlerData;
  fieldDiffs?: FieldDiff[];
  unchangedFieldDiffs?: FieldDiff[];
  aggregationSources?: SourceMap;
  imageAlternatives: MaintenanceImageAlternatives;
  plan?: OrganizePlan;
  pathDiff?: PathDiff;
}

export type CommittedMaintenanceFile = Omit<MaintenanceCommitItem, "entry">;

interface MaintenancePreparationDependencies {
  aggregationService: AggregationService;
  translateService: TranslateService;
  fileOrganizer: FileOrganizer;
  signalService: SignalService;
}

interface PrepareOptions {
  createDirectories: boolean;
  emitLogs?: boolean;
  onProgress?: (stepPercent: number) => void;
  signal?: AbortSignal;
}

export class MaintenancePreparationService {
  private readonly logger = loggerService.getLogger("MaintenancePreparationService");

  constructor(
    private readonly deps: MaintenancePreparationDependencies,
    private readonly preset: MaintenancePreset,
  ) {}

  async prepareFile(
    entry: LocalScanEntry,
    config: Configuration,
    options: PrepareOptions,
  ): Promise<PreparedMaintenanceFile> {
    const { fileInfo } = entry;
    const { steps } = this.preset;
    let crawlerData: CrawlerData | undefined;
    let aggregationSources: SourceMap | undefined;
    let imageAlternatives: MaintenanceImageAlternatives = {};

    throwIfAborted(options.signal);

    if (!steps.aggregate && entry.scanError) {
      throw new Error(entry.scanError);
    }

    if (steps.aggregate) {
      if (options.emitLogs) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] Fetching metadata online...`);
      }

      const aggregationResult = await this.deps.aggregationService.aggregate(fileInfo.number, config, options.signal);
      throwIfAborted(options.signal);

      if (!aggregationResult) {
        throw new Error("联网获取元数据失败：无数据返回");
      }

      crawlerData = aggregationResult.data;
      aggregationSources = aggregationResult.sources;
      imageAlternatives = aggregationResult.imageAlternatives;
    } else {
      crawlerData = entry.crawlerData;
    }

    options.onProgress?.(30);

    if (steps.translate) {
      if (!crawlerData) {
        throw new Error("无元数据可供翻译");
      }

      if (options.emitLogs) {
        this.deps.signalService.showLogText(`[${fileInfo.number}] Translating metadata...`);
      }
      crawlerData = await this.translateCrawlerDataOrFallback(crawlerData, config, options.signal);
    }

    return await this.finalizePreparedFile({
      entry,
      config,
      crawlerData,
      aggregationSources,
      imageAlternatives,
      createDirectories: options.createDirectories,
      onProgress: options.onProgress,
      signal: options.signal,
    });
  }

  async prepareCommittedFile(
    entry: LocalScanEntry,
    config: Configuration,
    committed: CommittedMaintenanceFile,
    options: Pick<PrepareOptions, "createDirectories" | "onProgress">,
  ): Promise<PreparedMaintenanceFile> {
    if (!this.preset.steps.aggregate && entry.scanError) {
      throw new Error(entry.scanError);
    }

    return await this.finalizePreparedFile({
      entry,
      config,
      crawlerData: committed.crawlerData ?? entry.crawlerData,
      imageAlternatives: committed.imageAlternatives ?? {},
      createDirectories: options.createDirectories,
      onProgress: options.onProgress,
    });
  }

  private async finalizePreparedFile(input: {
    entry: LocalScanEntry;
    config: Configuration;
    crawlerData?: CrawlerData;
    aggregationSources?: SourceMap;
    imageAlternatives: MaintenanceImageAlternatives;
    createDirectories: boolean;
    onProgress?: (stepPercent: number) => void;
    signal?: AbortSignal;
  }): Promise<PreparedMaintenanceFile> {
    throwIfAborted(input.signal);

    const { fieldDiffs, unchangedFieldDiffs } = this.partitionDiffs(
      input.entry,
      input.config,
      input.crawlerData,
      input.imageAlternatives,
    );

    input.onProgress?.(50);

    const { plan, pathDiff } = await this.buildPlan(input.entry, input.config, input.crawlerData, {
      createDirectories: input.createDirectories,
      signal: input.signal,
    });

    return {
      crawlerData: input.crawlerData,
      fieldDiffs,
      unchangedFieldDiffs,
      aggregationSources: input.aggregationSources,
      imageAlternatives: input.imageAlternatives,
      plan,
      pathDiff,
    };
  }

  private partitionDiffs(
    entry: LocalScanEntry,
    config: Configuration,
    crawlerData: CrawlerData | undefined,
    imageAlternatives: MaintenanceImageAlternatives,
  ): { fieldDiffs?: FieldDiff[]; unchangedFieldDiffs?: FieldDiff[] } {
    if (!this.preset.steps.aggregate || !crawlerData) {
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

  private async buildPlan(
    entry: LocalScanEntry,
    config: Configuration,
    crawlerData: CrawlerData | undefined,
    options: {
      createDirectories: boolean;
      signal?: AbortSignal;
    },
  ): Promise<{ plan?: OrganizePlan; pathDiff?: PathDiff }> {
    throwIfAborted(options.signal);

    if (!(this.preset.steps.download || this.preset.steps.generateNfo || this.preset.steps.organize)) {
      return { plan: undefined, pathDiff: undefined };
    }

    if (!crawlerData) {
      throw new Error("本地 NFO 不存在或无法解析，无法执行后续步骤");
    }

    const rawPlan = this.deps.fileOrganizer.plan(entry.fileInfo, crawlerData, config, entry.nfoLocalState);
    if (this.preset.id === "refresh_data") {
      return {
        plan: rawPlan,
        pathDiff: undefined,
      };
    }

    const plan = await this.deps.fileOrganizer.resolveOutputPlan(rawPlan, entry.fileInfo.filePath, {
      createDirectories: options.createDirectories,
    });

    return {
      plan,
      pathDiff: diffPaths(entry, plan),
    };
  }

  private async translateCrawlerDataOrFallback(
    crawlerData: CrawlerData,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<CrawlerData> {
    throwIfAborted(signal);

    try {
      return await this.deps.translateService.translateCrawlerData(crawlerData, config, signal);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const message = toErrorMessage(error);
      this.logger.warn(`Translation failed for ${crawlerData.number}: ${message}`);
      return crawlerData;
    }
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
      scene_images: [],
      trailer_url: entry.assets.trailer ? entry.assets.trailer.split(/[\\/]/u).pop() : undefined,
      website: crawlerData.website,
    };
  }
}
