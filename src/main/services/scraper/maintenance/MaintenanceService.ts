import { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { type Configuration, configManager } from "@main/services/config";
import type { DeepPartial } from "@main/services/config/models";
import {
  createImageHostCooldownStore,
  type PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";
import type { CrawlerProvider } from "@main/services/crawler";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { didPromiseTimeout } from "@main/utils/async";
import { mergeDeep, toErrorMessage } from "@main/utils/common";
import type {
  LocalScanEntry,
  MaintenanceCommitItem,
  MaintenancePresetId,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "@shared/types";
import PQueue from "p-queue";
import { createAbortError } from "../abort";
import { AggregationService } from "../aggregation";
import { DownloadManager } from "../DownloadManager";
import { fileOrganizer } from "../FileOrganizer";
import type { FileScraperDependencies } from "../FileScraper";
import { NfoGenerator } from "../NfoGenerator";
import { TranslateService } from "../TranslateService";
import { LocalScanService } from "./LocalScanService";
import { MaintenanceFileScraper } from "./MaintenanceFileScraper";
import { getPreset, supportsMaintenanceExecution } from "./presets";

const createIdleMaintenanceStatus = (): MaintenanceStatus => ({
  state: "idle",
  totalEntries: 0,
  completedEntries: 0,
  successCount: 0,
  failedCount: 0,
});
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

interface MaintenanceRunContext {
  config: Configuration;
  concurrency: number;
  fileScraper: MaintenanceFileScraper;
  preset: ReturnType<typeof getPreset>;
}

export class MaintenanceService {
  private readonly logger = loggerService.getLogger("MaintenanceService");

  private readonly localScanService = new LocalScanService();

  private readonly imageHostCooldownStore: PersistentCooldownStore;

  private readonly actorImageService: ActorImageService;

  private readonly actorSourceProvider: ActorSourceProvider | undefined;

  private status: MaintenanceStatus = createIdleMaintenanceStatus();

  private operationController: AbortController | null = null;

  private queue: PQueue | null = null;

  private currentOperationPromise: Promise<void> | null = null;

  private pausedStateBeforePause: "previewing" | "executing" | null = null;

  constructor(
    private readonly signalService: SignalService,
    private readonly networkClient: NetworkClient,
    private readonly crawlerProvider: CrawlerProvider,
    actorImageService?: ActorImageService,
    actorSourceProvider?: ActorSourceProvider,
    imageHostCooldownStore?: PersistentCooldownStore,
  ) {
    this.imageHostCooldownStore = imageHostCooldownStore ?? createImageHostCooldownStore();
    this.actorImageService = actorImageService ?? new ActorImageService();
    this.actorSourceProvider = actorSourceProvider;
  }

  getStatus(): MaintenanceStatus {
    return { ...this.status };
  }

  async scan(dirPath: string): Promise<LocalScanEntry[]> {
    if (this.status.state !== "idle") {
      throw new Error("Maintenance is already running");
    }

    this.status = { ...createIdleMaintenanceStatus(), state: "scanning" };
    this.signalService.showLogText("Scanning maintenance directories");
    this.signalService.resetProgress();
    return await this.trackOperation(
      async (signal) => {
        const config = await configManager.getValidated();
        const entries = await this.localScanService.scan(dirPath, config.paths.sceneImagesFolder, signal);
        this.signalService.showLogText(`Maintenance scan completed. Found ${entries.length} item(s).`);
        return entries;
      },
      new AbortController(),
      () => {
        this.status = createIdleMaintenanceStatus();
      },
    );
  }

  async scanFiles(filePaths: string[]): Promise<LocalScanEntry[]> {
    if (this.status.state !== "idle") {
      throw new Error("Maintenance is already running");
    }

    const selectedPaths = filePaths.map((filePath) => filePath.trim()).filter(Boolean);
    if (selectedPaths.length === 0) {
      throw new Error("No files selected");
    }

    this.status = { ...createIdleMaintenanceStatus(), state: "scanning" };
    this.signalService.showLogText("Scanning selected maintenance files");
    this.signalService.resetProgress();
    return await this.trackOperation(
      async (signal) => {
        const config = await configManager.getValidated();
        const entries = await this.localScanService.scanFiles(selectedPaths, config.paths.sceneImagesFolder, signal);
        this.signalService.showLogText(`Maintenance scan completed. Found ${entries.length} item(s).`);
        return entries;
      },
      new AbortController(),
      () => {
        this.status = createIdleMaintenanceStatus();
      },
    );
  }

  async preview(entries: LocalScanEntry[], presetId: MaintenancePresetId): Promise<MaintenancePreviewResult> {
    if (this.status.state !== "idle") {
      throw new Error("Maintenance is already running");
    }

    if (entries.length === 0) {
      throw new Error("No entries to process");
    }

    this.status = {
      state: "previewing",
      totalEntries: entries.length,
      completedEntries: 0,
      successCount: 0,
      failedCount: 0,
    };
    this.signalService.resetProgress();
    return await this.trackOperation(
      async (signal) => {
        const runContext = await this.createRunContext(presetId);
        const queue = new PQueue({ concurrency: runContext.concurrency });
        this.queue = queue;
        const items = await Promise.all(
          entries.map((entry) =>
            queue.add(
              async () => {
                const item = await runContext.fileScraper.previewFile(entry, runContext.config, signal);
                this.status.completedEntries += 1;
                if (item.status === "ready") {
                  this.status.successCount += 1;
                } else {
                  this.status.failedCount += 1;
                }
                this.signalService.setProgress(
                  Math.round((this.status.completedEntries / entries.length) * 100),
                  this.status.completedEntries,
                  entries.length,
                );
                return item;
              },
              signal ? { signal } : undefined,
            ),
          ),
        );

        return {
          items,
        };
      },
      new AbortController(),
      () => {
        this.status = createIdleMaintenanceStatus();
        this.queue = null;
      },
    );
  }

  async execute(items: MaintenanceCommitItem[], presetId: MaintenancePresetId): Promise<void> {
    if (this.status.state !== "idle") {
      throw new Error("Maintenance is already running");
    }

    if (items.length === 0) {
      throw new Error("No entries to process");
    }

    const runContext = await this.createRunContext(presetId);
    const execution = { items, ...runContext };
    const controller = new AbortController();
    const totalItems = execution.items.length;
    this.queue = new PQueue({ concurrency: execution.concurrency });
    this.operationController = controller;

    this.status = {
      state: "executing",
      totalEntries: totalItems,
      completedEntries: 0,
      successCount: 0,
      failedCount: 0,
    };

    this.signalService.showLogText(`Starting maintenance run for preset ${execution.preset.id}. Items: ${totalItems}`);
    this.signalService.resetProgress();

    void this.trackOperation(
      async () => {
        await this.runExecution(execution);
      },
      controller,
      () => {
        this.status = createIdleMaintenanceStatus();
        this.queue = null;
      },
    );
  }

  private async runExecution(execution: MaintenanceRunContext & { items: MaintenanceCommitItem[] }): Promise<void> {
    const { items, config } = execution;
    const queue = this.queue;
    const completedFileIds = new Set<string>();
    if (!queue) {
      throw new Error("Maintenance queue is not initialized");
    }

    for (const [index, item] of items.entries()) {
      const entry = item.entry;
      const fileIndex = index + 1;

      queue.add(async () => {
        if (this.operationController?.signal.aborted) return;

        this.signalService.showMaintenanceItemResult({
          fileId: entry.fileId,
          status: "processing",
        });

        try {
          const { entry, ...committed } = item;
          const result = await execution.fileScraper.processFile(
            entry,
            config,
            { fileIndex, totalFiles: items.length },
            this.operationController?.signal,
            committed,
          );

          this.status.completedEntries += 1;
          if (result.status === "success") {
            this.status.successCount += 1;
          } else {
            this.status.failedCount += 1;
          }
          completedFileIds.add(entry.fileId);
          this.signalService.showMaintenanceItemResult(result);
        } catch (error) {
          this.status.completedEntries += 1;
          this.status.failedCount += 1;
          completedFileIds.add(entry.fileId);
          this.logger.error(`Unexpected maintenance error while processing ${entry.fileInfo.number}`);
          this.signalService.showMaintenanceItemResult({
            fileId: entry.fileId,
            status: "failed",
            error: toErrorMessage(error),
          });
        }
      });
    }

    await queue.onIdle();
    const wasStopped = this.status.state === "stopping";

    if (wasStopped) {
      for (const item of items) {
        if (completedFileIds.has(item.entry.fileId)) {
          continue;
        }

        completedFileIds.add(item.entry.fileId);
        this.status.completedEntries += 1;
        this.status.failedCount += 1;
        this.signalService.showMaintenanceItemResult({
          fileId: item.entry.fileId,
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
  }

  private async createRunContext(presetId: MaintenancePresetId): Promise<MaintenanceRunContext> {
    const preset = getPreset(presetId);
    const baseConfig = await configManager.getValidated();
    const config = mergeDeep(baseConfig, preset.configOverrides as DeepPartial<Configuration>);
    if (!supportsMaintenanceExecution(preset)) {
      throw new Error("当前预设仅用于扫描本地数据，无需执行");
    }

    return {
      preset,
      config,
      fileScraper: new MaintenanceFileScraper(this.createDependencies(), preset),
      concurrency: Math.max(1, config.scrape.threadNumber),
    };
  }

  stop(): void {
    if (
      this.status.state !== "scanning" &&
      this.status.state !== "previewing" &&
      this.status.state !== "executing" &&
      this.status.state !== "paused"
    ) {
      return;
    }

    this.logger.info("Stopping maintenance operation");
    this.status = { ...this.status, state: "stopping" };
    this.operationController?.abort(createAbortError());
    this.queue?.clear();
  }

  pause(): void {
    if ((this.status.state !== "executing" && this.status.state !== "previewing") || !this.queue) return;

    this.logger.info("Pausing maintenance operation");
    this.pausedStateBeforePause = this.status.state;
    this.queue.pause();
    this.status = { ...this.status, state: "paused" };
  }

  resume(): void {
    if (this.status.state !== "paused" || !this.queue) return;

    this.logger.info("Resuming maintenance operation");
    this.status = { ...this.status, state: this.pausedStateBeforePause ?? "executing" };
    this.pausedStateBeforePause = null;
    this.queue.start();
  }

  async waitForIdle(): Promise<void> {
    await (this.currentOperationPromise ?? Promise.resolve());
  }

  async shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    const operationPromise = this.currentOperationPromise;
    const timeoutMs = Math.max(0, Math.trunc(options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS));
    if (operationPromise) {
      this.logger.info("Shutting down maintenance service");
      if (this.status.state === "executing" || this.status.state === "paused") {
        this.stop();
      } else {
        this.operationController?.abort(createAbortError());
        this.queue?.clear();
      }

      const timedOut = await didPromiseTimeout(operationPromise, timeoutMs);
      if (timedOut) {
        this.logger.warn(`Timed out waiting ${timeoutMs}ms for maintenance service shutdown`);
      }
    }

    await this.imageHostCooldownStore.flush();
  }

  private createDependencies(): FileScraperDependencies {
    return {
      aggregationService: new AggregationService(this.crawlerProvider),
      translateService: new TranslateService(this.networkClient),
      nfoGenerator: new NfoGenerator(),
      downloadManager: new DownloadManager(this.networkClient, {
        imageHostCooldownStore: this.imageHostCooldownStore,
      }),
      fileOrganizer,
      signalService: this.signalService,
      actorImageService: this.actorImageService,
      actorSourceProvider: this.actorSourceProvider,
    };
  }

  private trackOperation<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    controller?: AbortController,
    onFinally?: () => void,
  ): Promise<T> {
    const signal = controller?.signal;
    const taskPromise = Promise.resolve().then(async () => {
      return await operation(signal);
    });

    let trackedPromise!: Promise<void>;
    const finalizedPromise = taskPromise.finally(() => {
      if (this.currentOperationPromise === trackedPromise) {
        this.currentOperationPromise = null;
      }
      if (this.operationController === controller) {
        this.operationController = null;
      }
      this.pausedStateBeforePause = null;
      onFinally?.();
    });

    trackedPromise = finalizedPromise.then(
      () => undefined,
      () => undefined,
    );
    this.currentOperationPromise = trackedPromise;
    this.operationController = controller ?? null;

    return finalizedPromise;
  }
}
