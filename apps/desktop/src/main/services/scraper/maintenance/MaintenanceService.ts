import { createDesktopMediaRootService } from "@main/services/mediaRoots";
import type { DesktopPersistenceService } from "@main/services/persistence";
import type { SignalService } from "@main/services/SignalService";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import type { ConfiguredMediaRootService } from "@mdcz/runtime/library";
import {
  createMaintenanceLibraryPort,
  type MaintenanceCoordinatorEvent,
  type MaintenanceRunHandle,
  type MaintenanceRuntime,
  MaintenanceSessionCoordinator,
} from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import type { ActorImageService } from "@mdcz/runtime/scrape";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyBatch,
  MaintenanceApplySelection,
  MaintenancePreviewBatch,
} from "@mdcz/shared/maintenanceTasks";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { MaintenancePresetId, MaintenanceStatus } from "@mdcz/shared/types";
import { createDesktopMaintenanceRuntime } from "./runtimeFactory";

export interface MaintenanceServiceDependencies {
  signalService: SignalService;
  networkClient: NetworkClient;
  crawlerProvider: CrawlerProvider;
  persistenceService: DesktopPersistenceService;
  actorImageService: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  imageHostCooldownStore: PersistentCooldownStore;
  mediaRoots?: ConfiguredMediaRootService;
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
  private readonly signalService: SignalService;
  private readonly persistenceService: DesktopPersistenceService;
  private readonly imageHostCooldownStore: PersistentCooldownStore;
  private readonly runtime: MaintenanceRuntime;
  private readonly coordinator: MaintenanceSessionCoordinator;

  constructor(deps: MaintenanceServiceDependencies) {
    this.signalService = deps.signalService;
    this.persistenceService = deps.persistenceService;
    this.imageHostCooldownStore = deps.imageHostCooldownStore;
    const mediaRoots = deps.mediaRoots ?? createDesktopMediaRootService(deps.persistenceService);
    this.runtime =
      deps.runtime ??
      createDesktopMaintenanceRuntime({
        actorImageService: deps.actorImageService,
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
            return await mediaRoots.get(rootId);
          },
          list: async () => await mediaRoots.listRoots(),
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
          resolveRoot: async (rootId) => await mediaRoots.get(rootId),
        }),
        events: { publish: async (event) => await this.publishCoordinatorEvent(event) },
      });
  }

  async getStatus(sessionId?: string): Promise<MaintenanceStatus> {
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

  async startPreview(
    refs: RootFileRef[],
    presetId: MaintenancePresetId,
  ): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    if (refs.length === 0) throw new Error("No files selected");
    const rootId = refs[0]?.rootId;
    if (!rootId) throw new Error("维护文件缺少媒体目录");
    this.signalService.resetProgress();
    return await this.coordinator.startPreview({ rootId, presetId, refs });
  }

  async execute(
    selections: MaintenanceApplySelection[],
    presetId: MaintenancePresetId,
  ): Promise<MaintenanceRunHandle<MaintenanceApplyBatch>> {
    if (selections.length === 0) throw new Error("No entries to process");
    const session = await this.requireActiveSession();
    if (session.presetId !== presetId) throw new Error("维护预设与当前任务不一致");
    if (presetId === "read_local") throw new Error("当前预设仅用于扫描本地数据，无需执行");
    const previewIds = new Set(session.previews.map((preview) => preview.id));
    if (selections.some((selection) => !previewIds.has(selection.previewId))) {
      throw new Error("维护项目不属于当前任务");
    }
    this.signalService.resetProgress();
    const handle = await this.coordinator.beginApply({ sessionId: session.id, selections });
    void handle.completion.catch((error) => this.signalService.showLogText(String(error), "error"));
    return handle;
  }

  async stop(): Promise<void> {
    const task = await this.requireActiveSession();
    await this.coordinator.stop(task.id);
  }

  async pause(): Promise<void> {
    const task = await this.requireActiveSession();
    await this.coordinator.pause(task.id);
  }

  async resume(): Promise<void> {
    const task = await this.requireActiveSession();
    await this.coordinator.resume(task.id);
  }

  async getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null> {
    return await this.coordinator.getActiveSession();
  }

  async updateDraft(input: { previewId: string; fieldSelections?: Record<string, "old" | "new"> }): Promise<void> {
    const session = await this.requireActiveSession();
    await this.coordinator.updateDraft({ sessionId: session.id, ...input });
  }

  async discardSession(): Promise<void> {
    await this.coordinator.discardSession((await this.getActiveSession())?.id);
    this.signalService.publishTaskSnapshot({ resource: "maintenance", snapshot: null });
  }

  async waitForIdle(): Promise<void> {
    await this.coordinator.waitForIdle();
  }

  async shutdown(_options: { timeoutMs?: number } = {}): Promise<void> {
    await this.coordinator.close();
    await this.imageHostCooldownStore.flush();
  }

  private async requireActiveSession(): Promise<MaintenanceActiveSessionSnapshot> {
    const session = await this.coordinator.getActiveSession();
    if (!session) throw new Error("维护会话不存在或已过期");
    return session;
  }

  private async publishCoordinatorEvent(event: MaintenanceCoordinatorEvent): Promise<void> {
    switch (event.kind) {
      case "log":
        this.signalService.showLogText(event.event.message);
        return;
      case "session-changed":
        this.signalService.publishTaskSnapshot({ resource: "maintenance", snapshot: event.session });
        this.signalService.invalidate("maintenance");
        return;
    }
  }
}
