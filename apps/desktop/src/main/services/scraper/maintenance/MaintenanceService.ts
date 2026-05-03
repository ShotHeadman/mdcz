import { dirname } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { configManager } from "@main/services/config";
import {
  createImageHostCooldownStore,
  type PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";
import type { CrawlerProvider } from "@main/services/crawler";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { didPromiseTimeout } from "@main/utils/async";
import { createIdleMaintenanceStatus, MaintenanceExecutor, type MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import type {
  LocalScanEntry,
  MaintenanceCommitItem,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewItem,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "@mdcz/shared/types";
import { createMediaRoot, type MediaRoot } from "@mdcz/storage";
import { createAbortError } from "../abort";
import { getPreset, supportsMaintenanceExecution } from "./presets";
import { toMaintenanceItemResult, toMaintenancePreviewItem } from "./resultAdapters";
import { createDesktopMaintenanceRuntime } from "./runtimeFactory";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

interface MaintenanceRunContext {
  concurrency: number;
  runtime: MaintenanceRuntime;
  preset: ReturnType<typeof getPreset>;
  root: MediaRoot;
}

export class MaintenanceService {
  private readonly logger = loggerService.getLogger("MaintenanceService");

  private readonly imageHostCooldownStore: PersistentCooldownStore;

  private readonly actorImageService: ActorImageService;

  private readonly actorSourceProvider: ActorSourceProvider | undefined;

  private readonly executor = new MaintenanceExecutor();

  private status: MaintenanceStatus = createIdleMaintenanceStatus();

  private operationController: AbortController | null = null;

  private currentOperationPromise: Promise<void> | null = null;

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
    this.status = createIdleMaintenanceStatus();
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
        const root = this.createRootForDirectory(dirPath);
        const entries = await this.createRuntime().scan({ root, signal });
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
        const entries = await this.createRuntime().scanFilePaths({ filePaths: selectedPaths, signal });
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
        const runContext = await this.createRunContext(presetId, entries);
        if (signal?.aborted) {
          throw createAbortError();
        }

        const items = await this.executor.run<LocalScanEntry, MaintenancePreviewItem>({
          state: "previewing",
          items: entries,
          concurrency: runContext.concurrency,
          runItem: async (entry, _index, itemSignal) => {
            const item = toMaintenancePreviewItem(
              (
                await runContext.runtime.previewEntries({
                  root: runContext.root,
                  presetId,
                  entries: [entry],
                  signal: signal ?? itemSignal,
                })
              )[0],
            );
            return {
              status: item.status === "ready" ? "success" : "failed",
              result: item,
              error: item.error,
            };
          },
          callbacks: {
            onProgress: (status) => {
              this.status = status;
              this.signalService.setProgress(
                Math.round((status.completedEntries / entries.length) * 100),
                status.completedEntries,
                entries.length,
              );
            },
          },
        });
        if (signal?.aborted || this.executor.wasStopped()) {
          throw createAbortError();
        }

        return {
          items,
        };
      },
      new AbortController(),
      () => {
        this.status = createIdleMaintenanceStatus();
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

    const runContext = await this.createRunContext(presetId, items);
    const execution = { items, ...runContext };
    const controller = new AbortController();
    const totalItems = execution.items.length;
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
      },
    );
  }

  private async runExecution(execution: MaintenanceRunContext & { items: MaintenanceCommitItem[] }): Promise<void> {
    const { items } = execution;
    const completedFileIds = new Set<string>();
    await this.executor.run<MaintenanceCommitItem, MaintenanceItemResult>({
      state: "executing",
      items,
      concurrency: execution.concurrency,
      callbacks: {
        onItemStart: (item) => {
          this.signalService.showMaintenanceItemResult({
            fileId: item.entry.fileId,
            status: "processing",
          });
        },
        onItemComplete: (item, _index, itemResult, status) => {
          this.status = status;
          completedFileIds.add(item.entry.fileId);
          if (itemResult.result) {
            this.signalService.showMaintenanceItemResult(itemResult.result);
            return;
          }
          this.signalService.showMaintenanceItemResult({
            fileId: item.entry.fileId,
            status: "failed",
            error: itemResult.error ?? "维护失败",
          });
        },
        onProgress: (status) => {
          this.status = status;
        },
      },
      runItem: async (item, index, signal) => {
        const { entry, ...committed } = item;
        const result = toMaintenanceItemResult(
          entry,
          await execution.runtime.applyEntry({
            root: execution.root,
            presetId: execution.preset.id,
            entry,
            committed,
            progress: { fileIndex: index + 1, totalFiles: items.length },
            signal,
          }),
        );
        return {
          status: result.status === "success" ? "success" : "failed",
          result,
          error: result.error,
        };
      },
    });
    const wasStopped = this.executor.wasStopped();

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

  private async createRunContext(
    presetId: MaintenancePresetId,
    entries: Array<MaintenanceCommitItem | LocalScanEntry> = [],
  ): Promise<MaintenanceRunContext> {
    const preset = getPreset(presetId);
    const baseConfig = await configManager.getValidated();
    if (!supportsMaintenanceExecution(preset)) {
      throw new Error("当前预设仅用于扫描本地数据，无需执行");
    }

    return {
      preset,
      runtime: this.createRuntime(),
      root: this.createRootForEntries(entries.map((entry) => ("entry" in entry ? entry.entry : entry))),
      concurrency: Math.max(1, baseConfig.scrape.threadNumber),
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
    this.executor.stop();
    this.operationController?.abort(createAbortError());
  }

  pause(): void {
    if (this.status.state !== "executing" && this.status.state !== "previewing") return;

    this.logger.info("Pausing maintenance operation");
    this.executor.pause();
    this.status = this.executor.getStatus();
  }

  resume(): void {
    if (this.status.state !== "paused") return;

    this.logger.info("Resuming maintenance operation");
    this.executor.resume();
    this.status = this.executor.getStatus();
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
        this.executor.stop();
        this.operationController?.abort(createAbortError());
      }

      const timedOut = await didPromiseTimeout(operationPromise, timeoutMs);
      if (timedOut) {
        this.logger.warn(`Timed out waiting ${timeoutMs}ms for maintenance service shutdown`);
      }
    }

    await this.imageHostCooldownStore.flush();
  }

  private createRuntime(): MaintenanceRuntime {
    return createDesktopMaintenanceRuntime({
      actorImageService: this.actorImageService,
      actorSourceProvider: this.actorSourceProvider,
      crawlerProvider: this.crawlerProvider,
      imageHostCooldownStore: this.imageHostCooldownStore,
      networkClient: this.networkClient,
      signalService: this.signalService,
    });
  }

  private createRootForDirectory(dirPath: string): MediaRoot {
    return createMediaRoot({
      id: "desktop-maintenance",
      displayName: "Desktop maintenance",
      hostPath: dirPath,
    });
  }

  private createRootForEntries(entries: LocalScanEntry[]): MediaRoot {
    const firstDir = entries[0]?.currentDir ?? dirname(entries[0]?.fileInfo.filePath ?? process.cwd());
    return this.createRootForDirectory(firstDir);
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
