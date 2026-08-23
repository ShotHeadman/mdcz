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
  InMemoryMaintenanceTaskStore,
  type MaintenanceCoordinatorEvent,
  type MaintenanceRunHandle,
  type MaintenanceRuntime,
  MaintenanceTaskCoordinator,
  type MaintenanceTaskStore,
} from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import type {
  MaintenanceApplyBatch,
  MaintenanceApplySelection,
  MaintenancePreviewBatch,
  MaintenanceTaskPreview,
  MaintenanceTaskSnapshot,
} from "@mdcz/shared/maintenanceTasks";
import type {
  LocalScanEntry,
  MaintenanceApplyCommit,
  MaintenanceClientSession,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewItem,
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
  store?: MaintenanceTaskStore;
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
  private readonly store: MaintenanceTaskStore;
  private readonly coordinator: MaintenanceTaskCoordinator;
  private readonly previewFileIds = new Map<string, string>();
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
    this.store = deps.store ?? new InMemoryMaintenanceTaskStore();
    this.coordinator =
      deps.coordinator ??
      new MaintenanceTaskCoordinator({
        store: this.store,
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
    const task = await this.resolveTask(taskId);
    if (!task || task.status === "completed" || task.status === "failed") return idleStatus();
    const execution = await this.store.readExecution(task.id);
    return {
      state:
        task.status === "paused"
          ? "paused"
          : task.status === "stopping"
            ? "stopping"
            : execution.phase === "preview"
              ? "previewing"
              : "executing",
      totalEntries: task.totalEntries,
      completedEntries: task.completedEntries,
      successCount: task.successCount,
      failedCount: task.failedCount,
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
    const fileIdByPath = new Map<string, string>(
      refs.map((ref, index) => [ref.relativePath, entries[index]?.fileId ?? ref.relativePath]),
    );
    this.signalService.resetProgress();
    const handle = await this.coordinator.startPreview({ rootId: root.id, presetId, refs });
    const completion = handle.completion.then((batch) => {
      for (const preview of batch.items) {
        this.previewFileIds.set(preview.id, fileIdByPath.get(preview.relativePath) ?? preview.relativePath);
      }
      return batch;
    });
    return { task: handle.task, completion };
  }

  async preview(entries: LocalScanEntry[], presetId: MaintenancePresetId): Promise<MaintenancePreviewResult> {
    const handle = await this.startPreview(entries, presetId);
    const batch = await handle.completion;
    return this.toPreviewResult(batch);
  }

  toPreviewResult(batch: MaintenancePreviewBatch): MaintenancePreviewResult {
    return { items: batch.items.map((item) => this.toLegacyPreview(item)) };
  }

  async execute(
    taskId: string,
    items: MaintenanceApplyCommit[],
    presetId: MaintenancePresetId,
  ): Promise<MaintenanceRunHandle<MaintenanceApplyBatch>> {
    if (items.length === 0) throw new Error("No entries to process");
    const state = await this.persistenceService.getState();
    const execution = await this.store.readExecution(taskId);
    if (execution.presetId !== presetId) throw new Error("维护预设与当前任务不一致");
    if (presetId === "read_local") throw new Error("当前预设仅用于扫描本地数据，无需执行");
    const task = await this.coordinator.getTask(taskId);
    const root = await state.repositories.mediaRoots.get(task.rootId);
    const previews = await this.store.listPreviews(taskId);
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
      this.previewFileIds.set(preview.id, item.entry.fileId);
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

  async getActiveSession(): Promise<MaintenanceClientSession | null> {
    const session = await this.store.getActiveSession();
    if (!session) return null;
    const fileIdByPreviewId = new Map<string, string>();
    const entries = session.previews.flatMap((preview) => {
      if (!preview.entry) return [];
      const fileId = this.previewFileIds.get(preview.id) ?? preview.entry.fileId;
      fileIdByPreviewId.set(preview.id, fileId);
      return [{ ...preview.entry, fileId }];
    });
    const previewItems = session.previews.map((preview) => {
      const item = this.toLegacyPreview(preview);
      const fileId = fileIdByPreviewId.get(preview.id) ?? item.fileId;
      fileIdByPreviewId.set(preview.id, fileId);
      return { ...item, fileId };
    });
    const fieldSelections = Object.fromEntries(
      Object.entries(session.draft.fieldSelections).flatMap(([previewId, selections]) => {
        const fileId = fileIdByPreviewId.get(previewId);
        return fileId ? [[fileId, selections]] : [];
      }),
    );
    const imageSelections = Object.fromEntries(
      Object.entries(session.draft.imageSelections).flatMap(([previewId, selections]) => {
        const fileId = fileIdByPreviewId.get(previewId);
        return fileId ? [[fileId, selections]] : [];
      }),
    );
    const currentResults: MaintenanceItemResult[] = session.applyItems.flatMap((item) => {
      if (item.status !== "pending" && item.status !== "processing") return [];
      const fileId = this.previewFileIds.get(item.previewId) ?? fileIdByPreviewId.get(item.previewId);
      return fileId ? [{ fileId, batchId: item.batchId, status: item.status }] : [];
    });
    return {
      taskId: session.task.id,
      batchId: session.execution.batchId,
      presetId: session.execution.presetId,
      entries,
      preview: { items: previewItems },
      fieldSelections,
      imageSelections,
      status: this.statusFromSession(session.task.status, session.execution.phase, session.execution),
      currentResults,
      recentResults:
        session.recentBatch?.items.map(({ log, result }) => {
          const fileId = result.entry?.fileId ?? this.previewFileIds.get(log.previewId) ?? log.relativePath;
          return {
            fileId,
            batchId: log.batchId,
            status: result.status,
            ...(result.error ? { error: result.error } : {}),
            ...(result.crawlerData ? { crawlerData: result.crawlerData } : {}),
            ...(result.entry ? { updatedEntry: result.entry } : {}),
            ...(result.fieldDiffs ? { fieldDiffs: result.fieldDiffs } : {}),
            ...(result.unchangedFieldDiffs ? { unchangedFieldDiffs: result.unchangedFieldDiffs } : {}),
            ...(result.pathDiff ? { pathDiff: result.pathDiff } : {}),
          };
        }) ?? [],
    };
  }

  async updateDraft(input: {
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
    imageSelections?: Record<string, string>;
  }): Promise<void> {
    const taskId = await this.resolveActiveTaskId();
    if (!taskId) throw new Error("没有活动的维护会话");
    await this.store.updateDraft({ taskId, ...input });
  }

  async discardSession(): Promise<void> {
    const taskId = await this.resolveActiveTaskId();
    await this.store.discardSession(taskId ?? undefined);
    this.previewFileIds.clear();
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

  private statusFromSession(
    taskStatus: MaintenanceTaskSnapshot["status"],
    phase: "preview" | "apply",
    progress: Pick<MaintenanceTaskSnapshot, "totalEntries" | "completedEntries" | "successCount" | "failedCount">,
  ): MaintenanceStatus {
    return {
      state:
        taskStatus === "paused"
          ? "paused"
          : taskStatus === "stopping"
            ? "stopping"
            : taskStatus === "queued" || taskStatus === "running"
              ? phase === "preview"
                ? "previewing"
                : "executing"
              : "idle",
      totalEntries: progress.totalEntries,
      completedEntries: progress.completedEntries,
      successCount: progress.successCount,
      failedCount: progress.failedCount,
    };
  }

  private toLegacyPreview(preview: MaintenanceTaskPreview): MaintenancePreviewItem {
    const item: MaintenancePreviewItem = {
      fileId: this.previewFileIds.get(preview.id) ?? preview.relativePath,
      previewId: preview.id,
      taskId: preview.taskId,
      status: preview.status === "ready" ? "ready" : "blocked",
    };
    if (preview.error) item.error = preview.error;
    if (preview.fieldDiffs.length > 0) item.fieldDiffs = preview.fieldDiffs;
    if (preview.unchangedFieldDiffs.length > 0) item.unchangedFieldDiffs = preview.unchangedFieldDiffs;
    if (preview.pathDiff) item.pathDiff = preview.pathDiff;
    if (preview.proposedCrawlerData) item.proposedCrawlerData = preview.proposedCrawlerData;
    if (preview.imageAlternatives) item.imageAlternatives = preview.imageAlternatives;
    return item;
  }

  private async publishCoordinatorEvent(event: MaintenanceCoordinatorEvent): Promise<void> {
    switch (event.kind) {
      case "log":
        this.signalService.showLogText(event.event.message);
        return;
      case "progress": {
        const { completedEntries, totalEntries } = event.progress;
        this.signalService.setProgress(
          totalEntries > 0 ? Math.round((completedEntries / totalEntries) * 100) : 100,
          completedEntries,
          totalEntries,
        );
        return;
      }
      case "preview-item":
        this.previewFileIds.set(event.preview.id, event.entry.fileId);
        return;
      case "apply-item": {
        const fileId =
          event.result.entry?.fileId ?? this.previewFileIds.get(event.log.previewId) ?? event.log.relativePath;
        const payload: MaintenanceItemResult = {
          fileId,
          batchId: event.log.batchId,
          status: event.result.status,
        };
        if (event.result.error) payload.error = event.result.error;
        if (event.result.crawlerData) payload.crawlerData = event.result.crawlerData;
        if (event.result.entry) payload.updatedEntry = event.result.entry;
        if (event.result.fieldDiffs) payload.fieldDiffs = event.result.fieldDiffs;
        if (event.result.unchangedFieldDiffs) payload.unchangedFieldDiffs = event.result.unchangedFieldDiffs;
        if (event.result.pathDiff) payload.pathDiff = event.result.pathDiff;
        this.signalService.showMaintenanceItemResult(payload);
        return;
      }
      case "task-failed":
        this.signalService.showLogText(event.error, "error");
        return;
      case "task-changed":
        return;
    }
  }
}
