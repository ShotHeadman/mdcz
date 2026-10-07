import { createDesktopMediaRootService } from "@main/services/mediaRoots";
import type { DesktopPersistenceService } from "@main/services/persistence";
import type { SignalService } from "@main/services/SignalService";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import type { ConfiguredMediaRootService } from "@mdcz/runtime/library";
import {
  type MaintenanceCoordinatorEvent,
  type MaintenanceRunHandle,
  type MaintenanceRuntime,
  type MaintenanceRuntimeDependencies,
  MaintenanceSessionCoordinator,
  resolveMaintenanceTarget,
} from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import type { ActorImageService } from "@mdcz/runtime/scrape";
import { createDirectoryScope, discoverDirectoryFiles } from "@mdcz/runtime/scrape";
import type { DirectorySource } from "@mdcz/shared/directoryTasks";
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
  prepareScrapeItem?: MaintenanceRuntimeDependencies["prepareScrapeItem"];
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
  private readonly mediaRoots: ConfiguredMediaRootService;
  private readonly coordinator: MaintenanceSessionCoordinator;

  constructor(deps: MaintenanceServiceDependencies) {
    this.signalService = deps.signalService;
    this.persistenceService = deps.persistenceService;
    this.imageHostCooldownStore = deps.imageHostCooldownStore;
    const mediaRoots = deps.mediaRoots ?? createDesktopMediaRootService(deps.persistenceService);
    this.mediaRoots = mediaRoots;
    this.runtime =
      deps.runtime ??
      createDesktopMaintenanceRuntime({
        actorImageService: deps.actorImageService,
        actorSourceProvider: deps.actorSourceProvider,
        crawlerProvider: deps.crawlerProvider,
        imageHostCooldownStore: this.imageHostCooldownStore,
        networkClient: deps.networkClient,
        signalService: deps.signalService,
        prepareScrapeItem: deps.prepareScrapeItem,
        recordSiteResults: async (number, results) =>
          (await deps.persistenceService.getState()).repositories.siteResults.record(number, results),
        loadSiteResults: async (number) =>
          (await deps.persistenceService.getState()).repositories.siteResults.list(number),
      });
    this.coordinator =
      deps.coordinator ??
      new MaintenanceSessionCoordinator({
        roots: {
          assertRootIntegrity: (ids) => mediaRoots.assertRootIntegrity(ids),
          get: async (rootId) => {
            return await mediaRoots.get(rootId);
          },
          list: async () => await mediaRoots.listRoots(),
        },
        runtime: this.runtime,
        discoverDirectory: async (scope, configuration, signal, onProgress, inventory) => {
          return (
            await discoverDirectoryFiles({
              scope,
              configuration,
              signal,
              onProgress,
              inventory,
              mediaRoots,
              platform: "desktop",
            })
          ).refs;
        },
        persistence: {
          get: async () => {
            const { repositories } = await this.persistenceService.getState();
            return {
              library: repositories.library,
            };
          },
        },
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

  /** The runtime moving presets and the pending list's uncensored confirmation share. */
  get maintenanceRuntime(): MaintenanceRuntime {
    return this.runtime;
  }

  async rerunDirectory(sessionId: string): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    return await this.coordinator.rerunDirectory(sessionId);
  }

  async startDirectory(
    source: DirectorySource,
    presetId: MaintenancePresetId,
    libraryId?: string,
  ): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    const configuration = await this.runtime.getConfiguration();
    const output = await this.libraryTarget(presetId, libraryId);
    const directoryScope = createDirectoryScope(
      source,
      output?.target.outputPath ?? source.scanDir,
      configuration,
      "maintenance",
    );
    const scan = await this.mediaRoots.admitDirectory({ hostPath: directoryScope.scanDir });
    return await this.coordinator.startPreview({
      rootId: scan.root.id,
      presetId,
      refs: [],
      outputRootId: output?.outputRootId ?? scan.root.id,
      outputRelativeDirectory: output?.outputRelativeDirectory ?? scan.relativeDirectory,
      target: output?.target,
      directoryScope,
      configuration,
    });
  }

  async startPreview(
    refs: RootFileRef[],
    presetId: MaintenancePresetId,
    libraryId?: string,
  ): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    if (refs.length === 0) throw new Error("No files selected");
    const rootId = refs[0]?.rootId;
    if (!rootId) throw new Error("Maintenance file is missing a media directory");
    const output = await this.libraryTarget(presetId, libraryId);
    this.signalService.invalidate("maintenance");
    return await this.coordinator.startPreview({
      rootId,
      presetId,
      refs,
      outputRootId: output?.outputRootId,
      outputRelativeDirectory: output?.outputRelativeDirectory,
      target: output?.target,
      configuration: await this.runtime.getConfiguration(),
    });
  }

  private async libraryTarget(presetId: MaintenancePresetId, libraryId: string | undefined) {
    const { repositories } = await this.persistenceService.getState();
    return await resolveMaintenanceTarget(
      presetId,
      libraryId ? repositories.mediaLibraries.get(libraryId) : undefined,
      this.mediaRoots,
    );
  }

  async execute(
    selections: MaintenanceApplySelection[],
    presetId: MaintenancePresetId,
  ): Promise<MaintenanceRunHandle<MaintenanceApplyBatch>> {
    if (selections.length === 0) throw new Error("No entries to process");
    const session = await this.requireActiveSession();
    if (session.presetId !== presetId) throw new Error("Maintenance preset does not match current task");
    const previewIds = new Set(session.previews.map((preview) => preview.id));
    if (selections.some((selection) => !previewIds.has(selection.previewId))) {
      throw new Error("Maintenance item does not belong to the current task");
    }
    this.signalService.invalidate("maintenance");
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
    if (!session) throw new Error("Maintenance session does not exist or has expired");
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
