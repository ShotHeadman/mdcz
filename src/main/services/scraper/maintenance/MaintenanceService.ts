import { type Configuration, configManager, configurationSchema } from "@main/services/config";
import type { DeepPartial } from "@main/services/config/models";
import type { CrawlerProvider } from "@main/services/crawler";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import type { LocalScanEntry, MaintenanceItemResult, MaintenancePresetId, MaintenanceStatus } from "@shared/types";
import PQueue from "p-queue";
import { AggregationService } from "../aggregation";
import { DownloadManager } from "../DownloadManager";
import { FileOrganizer } from "../FileOrganizer";
import type { FileScraperDependencies } from "../FileScraper";
import { NfoGenerator } from "../NfoGenerator";
import { TranslateService } from "../TranslateService";
import { LocalScanService } from "./LocalScanService";
import { MaintenanceFileScraper } from "./MaintenanceFileScraper";
import { getPreset } from "./presets";

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

export class MaintenanceService {
  private readonly logger = loggerService.getLogger("MaintenanceService");

  private readonly localScanService = new LocalScanService();

  private status: MaintenanceStatus = {
    state: "idle",
    totalEntries: 0,
    completedEntries: 0,
    successCount: 0,
    failedCount: 0,
  };

  private controller: AbortController | null = null;

  private queue: PQueue | null = null;

  constructor(
    private readonly signalService: SignalService,
    private readonly networkClient: NetworkClient,
    private readonly crawlerProvider: CrawlerProvider,
  ) {}

  getStatus(): MaintenanceStatus {
    return { ...this.status };
  }

  async scan(dirPath: string): Promise<LocalScanEntry[]> {
    if (this.status.state !== "idle") {
      throw new Error("Maintenance is already running");
    }

    this.status = { ...this.status, state: "scanning" };
    this.signalService.showLogText("[维护] 正在扫描目录...");

    try {
      await configManager.ensureLoaded();
      const config = configurationSchema.parse(await configManager.get());
      const entries = await this.localScanService.scan(dirPath, config.paths.sceneImagesFolder);

      this.signalService.showLogText(`[维护] 扫描完成：发现 ${entries.length} 个影片`);
      return entries;
    } finally {
      this.status = { ...this.status, state: "idle" };
    }
  }

  async execute(entries: LocalScanEntry[], presetId: MaintenancePresetId): Promise<void> {
    if (this.status.state !== "idle") {
      throw new Error("Maintenance is already running");
    }

    if (entries.length === 0) {
      throw new Error("No entries to process");
    }

    const preset = getPreset(presetId);
    await configManager.ensureLoaded();
    const baseConfig = configurationSchema.parse(await configManager.get());
    const config = mergeDeep(baseConfig, preset.configOverrides as DeepPartial<Configuration>);

    this.controller = new AbortController();
    this.queue = new PQueue({ concurrency: Math.max(1, config.scrape.threadNumber) });

    this.status = {
      state: "executing",
      totalEntries: entries.length,
      completedEntries: 0,
      successCount: 0,
      failedCount: 0,
    };

    this.signalService.showLogText(`[维护] 开始执行：${preset.label}，共 ${entries.length} 个条目`);
    this.signalService.resetProgress();

    try {
      const deps = this.createDependencies();
      const fileScraper = new MaintenanceFileScraper(deps, preset);

      for (const [index, entry] of entries.entries()) {
        const fileIndex = index + 1;

        this.queue.add(async () => {
          if (this.controller?.signal.aborted) return;

          try {
            const result = await fileScraper.processFile(
              entry,
              config,
              { fileIndex, totalFiles: entries.length },
              this.controller?.signal,
            );

            this.status.completedEntries += 1;
            if (result.scrapeResult.status === "success") {
              this.status.successCount += 1;
            } else {
              this.status.failedCount += 1;
            }

            const itemResult: MaintenanceItemResult = {
              entryId: entry.id,
              status: result.scrapeResult.status === "success" ? "success" : "failed",
              error: result.scrapeResult.error,
              fieldDiffs: result.fieldDiffs,
              pathDiff: result.pathDiff,
            };

            this.signalService.showMaintenanceItemResult(itemResult);
          } catch (error) {
            this.status.completedEntries += 1;
            this.status.failedCount += 1;
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Unexpected error processing ${entry.fileInfo.number}: ${message}`);
            this.signalService.showMaintenanceItemResult({
              entryId: entry.id,
              status: "failed",
              error: message,
            });
          }
        });
      }

      await this.queue.onIdle();

      this.signalService.showLogText(
        `[维护] 执行完成：成功 ${this.status.successCount}，失败 ${this.status.failedCount}`,
      );
    } finally {
      this.status = { ...this.status, state: "idle" };
      this.controller = null;
      this.queue = null;
    }
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
      fileOrganizer: new FileOrganizer(),
      signalService: this.signalService,
    };
  }
}
