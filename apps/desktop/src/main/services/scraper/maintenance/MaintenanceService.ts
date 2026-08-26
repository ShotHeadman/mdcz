import { ActorImageService } from "@main/services/ActorImageService";
import { configManager } from "@main/services/config";
import {
  createImageHostCooldownStore,
  type PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import type { DesktopPersistenceService } from "@main/services/persistence";
import type { SignalService } from "@main/services/SignalService";
import { createAbortError } from "@main/utils/abort";
import { toRootRelativePath } from "@mdcz/media-store";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import { createDesktopInputRoot, resolveDesktopInputRootPath } from "@mdcz/runtime/library";
import {
  type MaintenanceCoordinatorEvent,
  type MaintenanceRunHandle,
  type MaintenanceRuntime,
  MaintenanceTaskCoordinator,
} from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyBatch,
  MaintenanceApplySelection,
  MaintenancePreviewBatch,
  MaintenanceTaskSnapshot,
} from "@mdcz/shared/maintenanceTasks";
import type {
  LocalScanEntry,
  MaintenanceApplyCommit,
  MaintenancePresetId,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "@mdcz/shared/types";
import { createDesktopMaintenanceRuntime } from "./runtimeFactory";

export interface MaintenanceServiceDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  crawlerProvider: CrawlerProvider;
  persistenceService: DesktopPersistenceService;
  actorImageService?: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  imageHostCooldownStore?: PersistentCooldownStore;
  runtime?: MaintenanceRuntime;
  coordinator?: MaintenanceTaskCoordinator;
}

const idleStatus = (): MaintenanceStatus => ({
  state: "idle",
  totalEntries: 0,
  completedEntries: 0,
  successCount: 0,
  failedCount: 0,
});
const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export class MaintenanceService {
  private readonly logger = loggerService.getLogger("MaintenanceService");
  private readonly signalService: SignalService;
  private readonly persistenceService: DesktopPersistenceService;
  private readonly imageHostCooldownStore: PersistentCooldownStore;
  private readonly runtime: MaintenanceRuntime;
  private readonly coordinator: MaintenanceTaskCoordinator;
  private scanningStatus: MaintenanceStatus | null = null;
  private scanController: AbortController | null = null;
  private scanPromise: Promise<unknown> | null = null;

  constructor(deps: MaintenanceServiceDependencies) {
    this.signalService = deps.signalService;
    this.persistenceService = deps.persistenceService;
    this.imageHostCooldownStore = deps.imageHostCooldownStore ?? createImageHostCooldownStore();
    const actorImageService = deps.actorImageService ?? new ActorImageService();
    this.runtime =
      deps.runtime ??
      createDesktopMaintenanceRuntime({
        actorImageService,
        actorSourceProvider: deps.actorSourceProvider,
        crawlerProvider: deps.crawlerProvider,
        imageHostCooldownStore: this.imageHostCooldownStore,
        networkClient: deps.networkClient,
        signalService: deps.signalService,
      });
    this.coordinator =
      deps.coordinator ??
      new MaintenanceTaskCoordinator({
        roots: {
          getActiveRoot: async (rootId) => {
            const root = await (await deps.persistenceService.getState()).repositories.mediaRoots.get(rootId);
            if (!root.enabled || root.deleted) throw new Error(`Media root is not active: ${rootId}`);
            return root;
          },
        },
        runtime: this.runtime,
        library: {
          resolveSource: async (absolutePath) =>
            await (await this.persistenceService.getState()).repositories.library.resolveMaintenanceSource(
              absolutePath,
            ),
          preflightRefresh: async (input) =>
            await (await this.persistenceService.getState()).repositories.library.preflightMaintenanceRefresh(input),
          commitRefresh: async (input) =>
            await (await this.persistenceService.getState()).repositories.library.commitRefresh(input),
        },
        events: { publish: async (event) => await this.publishCoordinatorEvent(event) },
        concurrency: 1,
      });
  }

  async getStatus(taskId?: string): Promise<MaintenanceStatus> {
    if (this.scanningStatus) return { ...this.scanningStatus };
    const snapshot = await this.coordinator.getActiveSession();
    if (!snapshot || (taskId && snapshot.id !== taskId)) return idleStatus();
    return {
      state:
        snapshot.status === "paused"
          ? "paused"
          : snapshot.status === "stopping"
            ? "stopping"
            : snapshot.status === "queued" || snapshot.status === "running"
              ? snapshot.phase === "preview"
                ? "previewing"
                : "executing"
              : "idle",
      totalEntries: snapshot.totalEntries,
      completedEntries: snapshot.completedEntries,
      successCount: snapshot.successCount,
      failedCount: snapshot.failedCount,
    };
  }

  async scan(dirPath: string): Promise<LocalScanEntry[]> {
    await this.assertAvailableForScan();
    return await this.runScan("Scanning maintenance directories", async (signal) => {
      const root = createDesktopInputRoot(dirPath);
      return await this.runtime.scan({ root, signal });
    });
  }

  async scanFiles(filePaths: string[]): Promise<LocalScanEntry[]> {
    await this.assertAvailableForScan();
    const selectedPaths = filePaths.map((filePath) => filePath.trim()).filter(Boolean);
    if (selectedPaths.length === 0) throw new Error("No files selected");
    return await this.runScan(
      "Scanning selected maintenance files",
      async (signal) => await this.runtime.scanFilePaths({ filePaths: selectedPaths, signal }),
    );
  }

  async startPreview(
    entries: LocalScanEntry[],
    presetId: MaintenancePresetId,
  ): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    if (entries.length === 0) throw new Error("No entries to process");
    if (await this.hasActiveTask()) throw new Error("Maintenance is already running");
    const config = await configManager.getValidated();
    const rootPath = resolveDesktopInputRootPath(
      entries.map((entry) => entry.fileInfo.filePath),
      config.paths.mediaPath,
    );
    const root = createDesktopInputRoot(rootPath);
    await (await this.persistenceService.getState()).repositories.mediaRoots.upsert(root);
    const refs = entries.map((entry) => ({ relativePath: toRootRelativePath(root, entry.fileInfo.filePath) }));
    this.signalService.resetProgress();
    return await this.coordinator.startPreview({ rootId: root.id, presetId, refs });
  }

  async preview(entries: LocalScanEntry[], presetId: MaintenancePresetId): Promise<MaintenancePreviewResult> {
    const handle = await this.startPreview(entries, presetId);
    await handle.completion;
    const session = await this.getActiveSession();
    if (!session || session.id !== handle.task.id) throw new Error("维护会话已变化");
    return {
      items: session.previews.map((item) => ({
        fileId: item.entry?.fileId ?? item.relativePath,
        previewId: item.id,
        taskId: item.taskId,
        status: item.status === "ready" ? "ready" : "blocked",
        ...(item.error ? { error: item.error } : {}),
        ...(item.fieldDiffs.length ? { fieldDiffs: item.fieldDiffs } : {}),
        ...(item.unchangedFieldDiffs.length ? { unchangedFieldDiffs: item.unchangedFieldDiffs } : {}),
        ...(item.pathDiff ? { pathDiff: item.pathDiff } : {}),
        ...(item.proposedCrawlerData ? { proposedCrawlerData: item.proposedCrawlerData } : {}),
        ...(item.imageAlternatives ? { imageAlternatives: item.imageAlternatives } : {}),
      })),
    };
  }

  async execute(
    taskId: string,
    items: MaintenanceApplyCommit[],
    presetId: MaintenancePresetId,
  ): Promise<MaintenanceRunHandle<MaintenanceApplyBatch>> {
    if (items.length === 0) throw new Error("No entries to process");
    const state = await this.persistenceService.getState();
    const session = await this.coordinator.getActiveSession();
    if (!session || session.id !== taskId) throw new Error("维护任务不存在");
    if (session.presetId !== presetId) throw new Error("维护预设与当前任务不一致");
    if (presetId === "read_local") throw new Error("当前预设仅用于扫描本地数据，无需执行");
    const root = await state.repositories.mediaRoots.get(session.rootId);
    const previews = (await this.coordinator.readPreview(taskId)).items;
    const byPath = new Map(previews.map((preview) => [preview.relativePath, preview]));
    const selected = new Set<string>();
    const selections: MaintenanceApplySelection[] = items.map((item) => {
      const relativePath = toRootRelativePath(root, item.entry.fileInfo.filePath);
      const preview = byPath.get(relativePath);
      if (!preview) throw new Error(`维护项目不属于当前任务：${item.entry.fileInfo.filePath}`);
      if (selected.has(preview.id)) throw new Error(`维护项目重复：${relativePath}`);
      selected.add(preview.id);
      const fieldSelections = Object.fromEntries(
        preview.fieldDiffs.map((diff) => [
          diff.field,
          item.crawlerData && sameValue(item.crawlerData[diff.field], diff.oldValue) ? "old" : "new",
        ]),
      ) as Record<string, "old" | "new">;
      return { previewId: preview.id, fieldSelections };
    });
    this.signalService.resetProgress();
    const handle = await this.coordinator.beginApply({ taskId, selections });
    void handle.completion.catch((error) => this.signalService.showLogText(String(error), "error"));
    return handle;
  }

  async stop(taskId?: string): Promise<void> {
    if (this.scanController) {
      this.logger.info("Stopping maintenance scan");
      this.scanningStatus = { ...(this.scanningStatus ?? idleStatus()), state: "stopping" };
      this.scanController.abort(createAbortError());
      return;
    }
    const task = await this.resolveTask(taskId);
    if (task) await this.coordinator.stop(task.id);
  }

  async pause(taskId?: string): Promise<void> {
    if (this.scanController) return;
    const task = await this.resolveTask(taskId);
    if (task) await this.coordinator.pause(task.id);
  }

  async resume(taskId?: string): Promise<void> {
    if (this.scanController) return;
    const task = await this.resolveTask(taskId);
    if (task) await this.coordinator.resume(task.id);
  }

  async resolveActiveTaskId(preferredTaskId?: string): Promise<string | null> {
    const preferred = preferredTaskId ? await this.coordinator.getTask(preferredTaskId).catch(() => null) : null;
    if (preferred) return preferred.id;
    return (await this.resolveTask())?.id ?? null;
  }

  async getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null> {
    return await this.coordinator.getActiveSession();
  }

  async updateDraft(input: {
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
    imageSelections?: Record<string, string>;
  }): Promise<void> {
    const taskId = await this.resolveActiveTaskId();
    if (!taskId) throw new Error("没有活动的维护会话");
    await this.coordinator.updateDraft({ taskId, ...input });
  }

  async discardSession(): Promise<void> {
    const taskId = await this.resolveActiveTaskId();
    await this.coordinator.discardSession(taskId ?? undefined);
  }

  async waitForIdle(): Promise<void> {
    await (this.scanPromise ?? Promise.resolve());
    await this.coordinator.waitForIdle();
  }

  async shutdown(_options: { timeoutMs?: number } = {}): Promise<void> {
    this.scanController?.abort(createAbortError());
    await (this.scanPromise ?? Promise.resolve()).catch(() => undefined);
    await this.coordinator.close();
    await this.imageHostCooldownStore.flush();
  }

  private async runScan(
    message: string,
    operation: (signal: AbortSignal) => Promise<LocalScanEntry[]>,
  ): Promise<LocalScanEntry[]> {
    const controller = new AbortController();
    this.scanController = controller;
    this.scanningStatus = { ...idleStatus(), state: "scanning" };
    this.signalService.showLogText(message);
    this.signalService.resetProgress();
    const operationPromise = operation(controller.signal).then((entries) => {
      this.signalService.showLogText(`Maintenance scan completed. Found ${entries.length} item(s).`);
      return entries;
    });
    const tracked = operationPromise.finally(() => {
      if (this.scanController === controller) this.scanController = null;
      this.scanningStatus = null;
    });
    this.scanPromise = tracked.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await tracked;
    } finally {
      if (this.scanPromise) await this.scanPromise;
      this.scanPromise = null;
    }
  }

  private async assertAvailableForScan(): Promise<void> {
    if (this.scanController || (await this.hasActiveTask())) throw new Error("Maintenance is already running");
  }

  private async hasActiveTask(): Promise<boolean> {
    return (await this.coordinator.listTasks()).some((task) =>
      ["queued", "running", "paused", "stopping"].includes(task.status),
    );
  }

  private async resolveTask(taskId?: string): Promise<MaintenanceTaskSnapshot | null> {
    if (taskId) return await this.coordinator.getTask(taskId).catch(() => null);
    return (
      (await this.coordinator.listTasks()).find((task) =>
        ["queued", "running", "paused", "stopping"].includes(task.status),
      ) ?? null
    );
  }

  private async publishCoordinatorEvent(event: MaintenanceCoordinatorEvent): Promise<void> {
    switch (event.kind) {
      case "log":
        this.signalService.showLogText(event.event.message);
        return;
      case "task-changed":
        return;
    }
  }
}
