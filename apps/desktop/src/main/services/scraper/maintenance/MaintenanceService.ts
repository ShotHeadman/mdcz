import { getActorImageCacheDirectory, resolveDesktopDataFile } from "@main/appIdentity";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { DesktopPersistenceService } from "@main/services/persistence";
import type { SignalService } from "@main/services/SignalService";
import { createAbortError } from "@main/utils/abort";
import { toRootRelativePath } from "@mdcz/media-store";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import { resolveDesktopInputRootPath } from "@mdcz/runtime/library";
import {
  createMaintenanceLibraryPort,
  type MaintenanceCoordinatorEvent,
  type MaintenanceRunHandle,
  type MaintenanceRuntime,
  MaintenanceSessionCoordinator,
} from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService } from "@mdcz/runtime/scrape";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyBatch,
  MaintenanceApplySelection,
  MaintenancePreviewBatch,
  MaintenanceSessionSnapshot,
} from "@mdcz/shared/maintenanceTasks";
import type {
  LocalScanEntry,
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
  coordinator?: MaintenanceSessionCoordinator;
}

const idleStatus = (): MaintenanceStatus => ({
  state: "idle",
  totalEntries: 0,
  completedEntries: 0,
  successCount: 0,
  failedCount: 0,
});

export class MaintenanceService {
  private readonly logger = loggerService.getLogger("MaintenanceService");
  private readonly signalService: SignalService;
  private readonly persistenceService: DesktopPersistenceService;
  private readonly imageHostCooldownStore: PersistentCooldownStore;
  private readonly runtime: MaintenanceRuntime;
  private readonly coordinator: MaintenanceSessionCoordinator;
  private scanningStatus: MaintenanceStatus | null = null;
  private scanController: AbortController | null = null;
  private scanPromise: Promise<unknown> | null = null;

  constructor(deps: MaintenanceServiceDependencies) {
    this.signalService = deps.signalService;
    this.persistenceService = deps.persistenceService;
    this.imageHostCooldownStore =
      deps.imageHostCooldownStore ??
      new PersistentCooldownStore({
        filePath: resolveDesktopDataFile("image-host-cooldowns.json"),
        logger: loggerService.getLogger("ImageHostCooldownStore"),
      });
    const actorImageService =
      deps.actorImageService ??
      new ActorImageService({
        cacheRoot: getActorImageCacheDirectory(),
        logger: this.logger,
        networkClient: deps.networkClient,
      });
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
      new MaintenanceSessionCoordinator({
        roots: {
          get: async (rootId) => {
            const root = await (await deps.persistenceService.getState()).repositories.mediaRoots.get(rootId);
            return root;
          },
        },
        runtime: this.runtime,
        library: createMaintenanceLibraryPort({
          getRepositories: async () => {
            const { repositories } = await this.persistenceService.getState();
            return {
              library: repositories.library,
              mediaRoots: repositories.mediaRoots,
              publicationJournal: repositories.publicationJournal,
              libraryRepairIssues: repositories.libraryRepairIssues,
            };
          },
          resolveRoot: async (rootId) =>
            await (await this.persistenceService.getState()).repositories.mediaRoots.get(rootId),
        }),
        events: { publish: async (event) => await this.publishCoordinatorEvent(event) },
        concurrency: 1,
      });
  }

  async getStatus(sessionId?: string): Promise<MaintenanceStatus> {
    if (this.scanningStatus) return { ...this.scanningStatus };
    const snapshot = await this.coordinator.getActiveSession();
    if (!snapshot || (sessionId && snapshot.id !== sessionId)) return idleStatus();
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
      const root = await (await this.persistenceService.getState()).repositories.mediaRoots.ensurePath(dirPath);
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
    if (await this.hasActiveSession()) throw new Error("Maintenance is already running");
    const config = await configManager.getValidated();
    const rootPath = resolveDesktopInputRootPath(
      entries.map((entry) => entry.fileInfo.filePath),
      config.paths.mediaPath,
    );
    const root = await (await this.persistenceService.getState()).repositories.mediaRoots.ensurePath(rootPath);
    const refs = entries.map((entry) => ({ relativePath: toRootRelativePath(root, entry.fileInfo.filePath) }));
    this.signalService.resetProgress();
    return await this.coordinator.startPreview({ rootId: root.id, presetId, refs });
  }

  async preview(entries: LocalScanEntry[], presetId: MaintenancePresetId): Promise<MaintenancePreviewResult> {
    const handle = await this.startPreview(entries, presetId);
    await handle.completion;
    const session = await this.getActiveSession();
    if (!session || session.id !== handle.session.id) throw new Error("维护会话已变化");
    return {
      items: session.previews.map((item) => ({
        fileId: item.entry?.fileId ?? item.relativePath,
        previewId: item.id,
        sessionId: item.sessionId,
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
    sessionId: string,
    selections: MaintenanceApplySelection[],
    presetId: MaintenancePresetId,
  ): Promise<MaintenanceRunHandle<MaintenanceApplyBatch>> {
    if (selections.length === 0) throw new Error("No entries to process");
    const session = await this.coordinator.getActiveSession();
    if (!session || session.id !== sessionId) throw new Error("维护任务不存在");
    if (session.presetId !== presetId) throw new Error("维护预设与当前任务不一致");
    if (presetId === "read_local") throw new Error("当前预设仅用于扫描本地数据，无需执行");
    const previewIds = new Set(session.previews.map((preview) => preview.id));
    if (selections.some((selection) => !previewIds.has(selection.previewId))) {
      throw new Error("维护项目不属于当前任务");
    }
    this.signalService.resetProgress();
    const handle = await this.coordinator.beginApply({ sessionId, selections });
    void handle.completion.catch((error) => this.signalService.showLogText(String(error), "error"));
    return handle;
  }

  async stop(sessionId?: string): Promise<void> {
    if (this.scanController) {
      this.logger.info("Stopping maintenance scan");
      this.scanningStatus = { ...(this.scanningStatus ?? idleStatus()), state: "stopping" };
      this.scanController.abort(createAbortError());
      return;
    }
    const task = await this.resolveSession(sessionId);
    if (task) await this.coordinator.stop(task.id);
  }

  async pause(sessionId?: string): Promise<void> {
    if (this.scanController) return;
    const task = await this.resolveSession(sessionId);
    if (task) await this.coordinator.pause(task.id);
  }

  async resume(sessionId?: string): Promise<void> {
    if (this.scanController) return;
    const task = await this.resolveSession(sessionId);
    if (task) await this.coordinator.resume(task.id);
  }

  async resolveActiveSessionId(preferredSessionId?: string): Promise<string | null> {
    const preferred = preferredSessionId
      ? await this.coordinator.getSession(preferredSessionId).catch(() => null)
      : null;
    if (preferred) return preferred.id;
    return (await this.resolveSession())?.id ?? null;
  }

  async getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null> {
    return await this.coordinator.getActiveSession();
  }

  async updateDraft(input: { previewId: string; fieldSelections?: Record<string, "old" | "new"> }): Promise<void> {
    const sessionId = await this.resolveActiveSessionId();
    if (!sessionId) throw new Error("没有活动的维护会话");
    await this.coordinator.updateDraft({ sessionId, ...input });
  }

  async discardSession(): Promise<void> {
    const sessionId = await this.resolveActiveSessionId();
    await this.coordinator.discardSession(sessionId ?? undefined);
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
    if (this.scanController || (await this.hasActiveSession())) throw new Error("Maintenance is already running");
  }

  private async hasActiveSession(): Promise<boolean> {
    return (await this.coordinator.listSessions()).some((task) =>
      ["queued", "running", "paused", "stopping"].includes(task.status),
    );
  }

  private async resolveSession(sessionId?: string): Promise<MaintenanceSessionSnapshot | null> {
    if (sessionId) return await this.coordinator.getSession(sessionId).catch(() => null);
    return (
      (await this.coordinator.listSessions()).find((task) =>
        ["queued", "running", "paused", "stopping"].includes(task.status),
      ) ?? null
    );
  }

  private async publishCoordinatorEvent(event: MaintenanceCoordinatorEvent): Promise<void> {
    switch (event.kind) {
      case "log":
        this.signalService.showLogText(event.event.message);
        return;
      case "session-changed":
        return;
    }
  }
}
