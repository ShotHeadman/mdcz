import { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { type Configuration, configManager, configurationSchema } from "@main/services/config";
import type { DeepPartial } from "@main/services/config/models";
import type { CrawlerProvider } from "@main/services/crawler";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import type {
  LocalScanEntry,
  MaintenanceCommitItem,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "@shared/types";
import PQueue from "p-queue";
import { AggregationService } from "../aggregation";
import { DownloadManager } from "../DownloadManager";
import { fileOrganizer } from "../FileOrganizer";
import type { FileScraperDependencies } from "../FileScraper";
import { NfoGenerator } from "../NfoGenerator";
import { TranslateService } from "../TranslateService";
import { LocalScanService } from "./LocalScanService";
import { MaintenanceFileScraper } from "./MaintenanceFileScraper";
import { getPreset, supportsMaintenanceExecution } from "./presets";

function mergeDeep<T extends Record<string, unknown>>(base: T, overrides: DeepPartial<T>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(overrides)) {
    const overrideValue = (overrides as Record<string, unknown>)[key];
    const baseValue = result[key];

    if (
      overrideValue !== null &&
      overrideValue !== undefined &&
      typeof overrideValue === "object" &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === "object" &&
      baseValue !== null &&
      !Array.isArray(baseValue)
    ) {
      result[key] = mergeDeep(
        baseValue as Record<string, unknown>,
        overrideValue as DeepPartial<Record<string, unknown>>,
      );
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue;
    }
  }
  return result as T;
}

const createIdleMaintenanceStatus = (): MaintenanceStatus => ({
  state: "idle",
  totalEntries: 0,
  completedEntries: 0,
  successCount: 0,
  failedCount: 0,
});

export class MaintenanceService {
  private readonly logger = loggerService.getLogger("MaintenanceService");

  private readonly localScanService = new LocalScanService();

  private status: MaintenanceStatus = createIdleMaintenanceStatus();

  private controller: AbortController | null = null;

  private queue: PQueue | null = null;

  constructor(
    private readonly signalService: SignalService,
    private readonly networkClient: NetworkClient,
    private readonly crawlerProvider: CrawlerProvider,
    private readonly actorImageService = new ActorImageService(),
    private readonly actorSourceProvider?: ActorSourceProvider,
  ) {}

  getStatus(): MaintenanceStatus {
    return { ...this.status };
  }

  async scan(dirPath: string): Promise<LocalScanEntry[]> {
    if (this.status.state !== "idle") {
      throw new Error("Maintenance is already running");
    }

    this.status = { ...this.status, state: "scanning" };
    this.signalService.showLogText("Scanning maintenance directories");

    try {
      await configManager.ensureLoaded();
      const config = configurationSchema.parse(await configManager.get());
      const entries = await this.localScanService.scan(dirPath, config.paths.sceneImagesFolder);

      this.signalService.showLogText(`Maintenance scan completed. Found ${entries.length} item(s).`);
      return entries;
    } finally {
      this.status = createIdleMaintenanceStatus();
    }
  }

  async preview(entries: LocalScanEntry[], presetId: MaintenancePresetId): Promise<MaintenancePreviewResult> {
    if (this.status.state !== "idle") {
      throw new Error("Maintenance is already running");
    }

    if (entries.length === 0) {
      throw new Error("No entries to process");
    }

    const { preset, config } = await this.preparePresetConfig(presetId);
    if (!supportsMaintenanceExecution(preset)) {
      throw new Error("当前预设仅用于扫描本地数据，无需执行");
    }
    const deps = this.createDependencies();
    const fileScraper = new MaintenanceFileScraper(deps, preset);
    const queue = new PQueue({ concurrency: Math.max(1, config.scrape.threadNumber) });
    const items = await Promise.all(
      entries.map((entry) =>
        queue.add(async () => {
          return fileScraper.previewFile(entry, config);
        }),
      ),
    );

    return {
      items,
    };
  }

  async execute(items: MaintenanceCommitItem[], presetId: MaintenancePresetId): Promise<void> {
    if (this.status.state !== "idle") {
      throw new Error("Maintenance is already running");
    }

    if (items.length === 0) {
      throw new Error("No entries to process");
    }

    const { preset, config } = await this.preparePresetConfig(presetId);
    if (!supportsMaintenanceExecution(preset)) {
      throw new Error("当前预设仅用于扫描本地数据，无需执行");
    }
    const execution = { items, preset, config };
    this.controller = new AbortController();
    const totalItems = execution.items.length;
    this.queue = new PQueue({ concurrency: Math.max(1, execution.config.scrape.threadNumber) });

    this.status = {
      state: "executing",
      totalEntries: totalItems,
      completedEntries: 0,
      successCount: 0,
      failedCount: 0,
    };

    this.signalService.showLogText(`Starting maintenance run for preset ${execution.preset.id}. Items: ${totalItems}`);
    this.signalService.resetProgress();

    void this.runExecution(execution);
  }

  private async runExecution(execution: {
    items: MaintenanceCommitItem[];
    preset: ReturnType<typeof getPreset>;
    config: Configuration;
  }): Promise<void> {
    const { items, preset, config } = execution;
    const queue = this.queue;
    const completedEntryIds = new Set<string>();
    if (!queue) {
      throw new Error("Maintenance queue is not initialized");
    }

    try {
      const deps = this.createDependencies();
      const fileScraper = new MaintenanceFileScraper(deps, preset);

      for (const [index, item] of items.entries()) {
        const entry = item.entry;
        const fileIndex = index + 1;

        queue.add(async () => {
          if (this.controller?.signal.aborted) return;

          this.signalService.showMaintenanceItemResult({
            entryId: entry.id,
            status: "processing",
          });

          try {
            const result = await fileScraper.processFile(
              entry,
              config,
              { fileIndex, totalFiles: items.length },
              this.controller?.signal,
              {
                crawlerData: item.crawlerData,
                imageAlternatives: item.imageAlternatives,
                assetDecisions: item.assetDecisions,
              },
            );

            this.status.completedEntries += 1;
            if (result.scrapeResult.status === "success") {
              this.status.successCount += 1;
            } else {
              this.status.failedCount += 1;
            }
            completedEntryIds.add(entry.id);

            const itemResult: MaintenanceItemResult = {
              entryId: entry.id,
              status: result.scrapeResult.status === "success" ? "success" : "failed",
              error: result.scrapeResult.error,
              crawlerData: result.scrapeResult.crawlerData,
              updatedEntry: result.updatedEntry,
              fieldDiffs: result.fieldDiffs,
              unchangedFieldDiffs: result.unchangedFieldDiffs,
              pathDiff: result.pathDiff,
            };

            this.signalService.showMaintenanceItemResult(itemResult);
          } catch (error) {
            this.status.completedEntries += 1;
            this.status.failedCount += 1;
            completedEntryIds.add(entry.id);
            this.logger.error(`Unexpected maintenance error while processing ${entry.fileInfo.number}`);
            this.signalService.showMaintenanceItemResult({
              entryId: entry.id,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      }

      await queue.onIdle();
      const wasStopped = this.status.state === "stopping";

      if (wasStopped) {
        for (const item of items) {
          if (completedEntryIds.has(item.entry.id)) {
            continue;
          }

          completedEntryIds.add(item.entry.id);
          this.status.completedEntries += 1;
          this.status.failedCount += 1;
          this.signalService.showMaintenanceItemResult({
            entryId: item.entry.id,
            status: "failed",
            error: "维护已停止，项目未执行",
          });
        }
      }

      this.signalService.showLogText(
        wasStopped
          ? `Maintenance stopped. Succeeded: ${this.status.successCount}, Failed or canceled: ${this.status.failedCount}`
          : `Maintenance completed. Succeeded: ${this.status.successCount}, Failed: ${this.status.failedCount}`,
      );
    } finally {
      this.status = createIdleMaintenanceStatus();
      this.controller = null;
      this.queue = null;
    }
  }

  private async preparePresetConfig(presetId: MaintenancePresetId): Promise<{
    preset: ReturnType<typeof getPreset>;
    config: Configuration;
  }> {
    if (this.status.state !== "idle") {
      throw new Error("Maintenance is already running");
    }

    const preset = getPreset(presetId);
    await configManager.ensureLoaded();
    const baseConfig = configurationSchema.parse(await configManager.get());
    const config = mergeDeep(baseConfig, preset.configOverrides as DeepPartial<Configuration>);

    return { preset, config };
  }

  stop(): void {
    if (this.status.state !== "executing") return;

    this.logger.info("Stopping maintenance execution");
    this.status = { ...this.status, state: "stopping" };
    this.controller?.abort();
    this.queue?.clear();
  }

  private createDependencies(): FileScraperDependencies {
    return {
      configManager,
      aggregationService: new AggregationService(this.crawlerProvider),
      translateService: new TranslateService(this.networkClient),
      nfoGenerator: new NfoGenerator(),
      downloadManager: new DownloadManager(this.networkClient),
      fileOrganizer,
      signalService: this.signalService,
      actorImageService: this.actorImageService,
      actorSourceProvider: this.actorSourceProvider,
    };
  }
}
