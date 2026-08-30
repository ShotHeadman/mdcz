import {
  createMaintenanceLibraryPort,
  type MaintenanceCoordinatorEvent,
  type MaintenanceRuntime,
  MaintenanceSessionCoordinator,
} from "@mdcz/runtime/maintenance";
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
      roots: { get: async (rootId) => await this.mediaRoots.get(rootId) },
      runtime: this.runtime,
      library: createMaintenanceLibraryPort({
        getRepositories: async () => {
          const { repositories } = await this.persistence.getState();
          return {
            library: repositories.library,
            mediaRoots: repositories.mediaRoots,
            publicationJournal: repositories.publicationJournal,
            libraryRepairIssues: repositories.libraryRepairIssues,
          };
        },
        resolveRoot: async (rootId) => await this.mediaRoots.get(rootId),
      }),
      events: { publish: async (event) => await this.publishCoordinatorEvent(event) },
      concurrency: 1,
    });
  }

  async start(input: MaintenanceStartInput): Promise<MaintenanceMutationAckDto> {
    const root = await this.mediaRoots.get(input.rootId);
    const refs = input.refs?.map((ref) => {
      if (ref.rootId !== input.rootId) throw new Error("维护任务只能包含同一个媒体目录下的文件");
      return { relativePath: ref.relativePath };
    });
    const handle = await this.coordinator.startPreview({ rootId: root.id, presetId: input.presetId, refs });
    void handle.completion.catch(() => undefined);
    return { sessionId: handle.session.id };
  }

  async apply(input: MaintenanceApplyInput): Promise<MaintenanceMutationAckDto> {
    const session = await this.coordinator.getActiveSession();
    if (!session || session.id !== input.sessionId) throw new Error(`维护会话不存在：${input.sessionId}`);
    const previews = session.previews;
    const selectedIds = input.previewIds ? new Set(input.previewIds) : null;
    const selected = selectedIds ? previews.filter((preview) => selectedIds.has(preview.id)) : previews;
    if (previews.length === 0) throw new Error("没有可应用的维护预览");
    if (selectedIds && selected.length !== selectedIds.size) throw new Error("部分维护预览不存在或不属于当前任务");
    if (selected.length === 0) throw new Error("请选择要应用的维护预览");
    if (
      selected.some((preview) => preview.proposedCrawlerData) &&
      input.confirmationToken !== `maintenance:${input.sessionId}`
    ) {
      throw new Error("维护应用需要确认令牌");
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
        this.taskEvents.lifecycle(await this.toLifecycleEvent(event.session));
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
        (await this.mediaRoots.list()).roots.find((root) => root.id === task.rootId)?.displayName ?? "未知媒体目录",
      status: task.status,
      startedAt: task.startedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      error: task.error,
    };
  }
}
