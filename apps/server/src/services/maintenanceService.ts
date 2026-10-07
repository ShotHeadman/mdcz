import {
  type MaintenanceCoordinatorEvent,
  type MaintenanceRuntime,
  MaintenanceSessionCoordinator,
  resolveMaintenanceTarget,
} from "@mdcz/runtime/maintenance";
import { createDirectoryScope, discoverDirectoryFiles } from "@mdcz/runtime/scrape";
import type { MaintenanceActiveSessionSnapshot, MaintenanceApplySelection } from "@mdcz/shared/maintenanceTasks";
import type {
  MaintenanceApplyInput,
  MaintenanceMutationAckDto,
  MaintenanceSessionInput,
  MaintenanceStartInput,
} from "@mdcz/shared/serverDtos";
import { toTaskEventDto } from "../taskDto";
import type { TaskEventBus, TaskLifecycleEvent } from "../taskEvents";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { decorateTaskLog } from "./runtimeLogService";

export class MaintenanceService {
  private readonly runtime: MaintenanceRuntime;
  private readonly coordinator: MaintenanceSessionCoordinator;

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly taskEvents: TaskEventBus,
    runtime: MaintenanceRuntime,
  ) {
    this.runtime = runtime;
    this.coordinator = new MaintenanceSessionCoordinator({
      roots: {
        assertRootIntegrity: (ids) => this.mediaRoots.assertRootIntegrity(ids),
        get: async (rootId) => await this.mediaRoots.get(rootId),
        list: async () => await this.mediaRoots.listRoots(),
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
            mediaRoots: this.mediaRoots,
            platform: "server",
          })
        ).refs;
      },
      persistence: {
        get: async () => {
          const { repositories } = await this.persistence.getState();
          return {
            library: repositories.library,
          };
        },
      },
      events: { publish: async (event) => await this.publishCoordinatorEvent(event) },
    });
  }

  async start(input: MaintenanceStartInput): Promise<MaintenanceMutationAckDto> {
    if ("rerunSessionId" in input) {
      const handle = await this.coordinator.rerunDirectory(input.rerunSessionId);
      void handle.completion.catch(() => undefined);
      return { sessionId: handle.session.id };
    }
    const configuration = await this.runtime.getConfiguration();
    const { repositories } = await this.persistence.getState();
    const output = await resolveMaintenanceTarget(
      input.presetId,
      input.libraryId ? repositories.mediaLibraries.get(input.libraryId) : undefined,
      this.mediaRoots,
    );
    if ("source" in input) {
      const directoryScope = createDirectoryScope(
        input.source,
        output?.target.outputPath ?? input.source.scanDir,
        configuration,
        "maintenance",
      );
      const scan = await this.mediaRoots.admitDirectory({ hostPath: directoryScope.scanDir });
      const handle = await this.coordinator.startPreview({
        rootId: scan.root.id,
        presetId: input.presetId,
        refs: [],
        outputRootId: output?.outputRootId ?? scan.root.id,
        outputRelativeDirectory: output?.outputRelativeDirectory ?? scan.relativeDirectory,
        target: output?.target,
        directoryScope,
        configuration,
      });
      void handle.completion.catch(() => undefined);
      return { sessionId: handle.session.id };
    }
    const root = await this.mediaRoots.get(input.rootId);
    const handle = await this.coordinator.startPreview({
      rootId: root.id,
      presetId: input.presetId,
      refs: input.refs,
      outputRootId: output?.outputRootId,
      outputRelativeDirectory: output?.outputRelativeDirectory,
      target: output?.target,
      configuration,
    });
    void handle.completion.catch(() => undefined);
    return { sessionId: handle.session.id };
  }

  async execute(input: MaintenanceApplyInput): Promise<MaintenanceMutationAckDto> {
    const session = await this.coordinator.getActiveSession();
    if (!session || session.id !== input.sessionId)
      throw new Error(`Maintenance session not found: ${input.sessionId}`);
    const previews = session.previews;
    const selectedIds = input.previewIds ? new Set(input.previewIds) : null;
    const selected = selectedIds ? previews.filter((preview) => selectedIds.has(preview.id)) : previews;
    if (previews.length === 0) throw new Error("No maintenance previews to apply");
    if (selectedIds && selected.length !== selectedIds.size)
      throw new Error("Some maintenance previews do not exist or do not belong to the current task");
    if (selected.length === 0) throw new Error("Select the maintenance previews to apply");
    if (
      selected.some((preview) => preview.proposedCrawlerData) &&
      input.confirmationToken !== `maintenance:${input.sessionId}`
    ) {
      throw new Error("Applying maintenance requires a confirmation token");
    }
    const fieldsByPreview = new Map((input.selections ?? []).map((item) => [item.previewId, item.fieldSelections]));
    const selections: MaintenanceApplySelection[] = selected.map((preview) => ({
      previewId: preview.id,
      fieldSelections: fieldsByPreview.get(preview.id),
    }));
    const handle = await this.coordinator.beginApply({ sessionId: input.sessionId, selections });
    void handle.completion.catch(() => undefined);
    return { sessionId: input.sessionId };
  }

  async pause(input: MaintenanceSessionInput): Promise<MaintenanceMutationAckDto> {
    const snapshot = await this.coordinator.pause(input.sessionId);
    return { sessionId: snapshot.id };
  }

  async resume(input: MaintenanceSessionInput): Promise<MaintenanceMutationAckDto> {
    const snapshot = await this.coordinator.resume(input.sessionId);
    return { sessionId: snapshot.id };
  }

  async stop(input: MaintenanceSessionInput): Promise<MaintenanceMutationAckDto> {
    const snapshot = await this.coordinator.stop(input.sessionId);
    return { sessionId: snapshot.id };
  }

  async getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null> {
    return await this.coordinator.getActiveSession();
  }

  async automationTask(): Promise<(TaskLifecycleEvent & { updatedAt: string }) | null> {
    const session = await this.coordinator.getActiveSession();
    if (!session) return null;
    return {
      ...(await this.toLifecycleEvent({
        ...session,
        startedAt: session.timestamps.startedAt,
        completedAt: session.timestamps.completedAt,
      })),
      updatedAt: session.timestamps.updatedAt.toISOString(),
    };
  }

  async updateDraft(input: {
    sessionId: string;
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
  }): Promise<MaintenanceMutationAckDto> {
    await this.coordinator.updateDraft(input);
    return { sessionId: input.sessionId };
  }

  async discardSession(input?: { sessionId?: string }): Promise<MaintenanceMutationAckDto> {
    const sessionId = input?.sessionId ?? (await this.coordinator.getActiveSession())?.id ?? "";
    await this.coordinator.discardSession(input?.sessionId);
    return { sessionId };
  }

  async close(): Promise<void> {
    await this.coordinator.close();
  }

  private async publishCoordinatorEvent(event: MaintenanceCoordinatorEvent): Promise<void> {
    switch (event.kind) {
      case "session-changed":
        this.taskEvents.lifecycle(
          await this.toLifecycleEvent({
            ...event.session,
            startedAt: event.session.timestamps.startedAt,
            completedAt: event.session.timestamps.completedAt,
          }),
        );
        this.taskEvents.invalidate("maintenance");
        return;
      case "log": {
        const dto = toTaskEventDto({ ...event.event, taskId: event.sessionId });
        this.taskEvents.log(decorateTaskLog(dto));
        return;
      }
    }
  }

  private async toLifecycleEvent(task: {
    id: string;
    rootId: string;
    status: TaskLifecycleEvent["status"];
    startedAt?: Date | null;
    completedAt?: Date | null;
    error: string | null;
  }): Promise<TaskLifecycleEvent> {
    return {
      id: task.id,
      kind: "maintenance",
      rootId: task.rootId,
      rootDisplayName:
        (await this.mediaRoots.list()).roots.find((root) => root.id === task.rootId)?.displayName ??
        "Unknown media directory",
      status: task.status,
      startedAt: task.startedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      error: task.error,
    };
  }
}
