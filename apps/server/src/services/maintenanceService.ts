import path from "node:path";
import { mediaPathOwnership } from "@mdcz/runtime/library";
import {
  type MaintenanceCoordinatorEvent,
  type MaintenanceRuntime,
  MaintenanceTaskCoordinator,
} from "@mdcz/runtime/maintenance";
import { commitPublishedMedia, createPublicationPlan } from "@mdcz/runtime/publication";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import type { MaintenanceActiveSessionSnapshot, MaintenanceApplySelection } from "@mdcz/shared/maintenanceTasks";
import type {
  MaintenanceApplyInput,
  MaintenanceMutationAckDto,
  MaintenanceScanSelectedFilesInput,
  MaintenanceScanSelectedFilesResponse,
  MaintenanceStartInput,
  MaintenanceTaskInput,
} from "@mdcz/shared/serverDtos";
import { createServerMaintenanceRuntime } from "../maintenanceRuntimeFactory";
import { toTaskEventDto } from "../taskDto";
import type { TaskEventBus, TaskLifecycleEvent } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { decorateTaskLog } from "./runtimeLogService";

export class MaintenanceService {
  private readonly runtime: MaintenanceRuntime;
  private readonly coordinator: MaintenanceTaskCoordinator;

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    config: ServerConfigService,
    private readonly taskEvents: TaskEventBus,
    runtime?: MaintenanceRuntime,
    mappingStore?: TranslationMappingStore,
  ) {
    this.runtime = runtime ?? createServerMaintenanceRuntime(config, mappingStore);
    this.coordinator = new MaintenanceTaskCoordinator({
      roots: { getActiveRoot: async (rootId) => await this.mediaRoots.getActiveRoot(rootId) },
      runtime: this.runtime,
      library: {
        resolveSource: async (absolutePath) =>
          await (await this.persistence.getState()).repositories.library.resolveMaintenanceSource(absolutePath),
        preflightRefresh: async (input) =>
          await (await this.persistence.getState()).repositories.library.preflightMaintenanceRefresh(input),
        publishRefresh: async (input) => {
          const state = await this.persistence.getState();
          const refresh = await state.repositories.library.prepareRefresh(input.refresh);
          const plan = createPublicationPlan(
            input.operationId,
            "maintenance",
            input.plan,
            await state.repositories.mediaRoots.list(),
          );
          return await commitPublishedMedia(plan, {
            resolveRoot: async (rootId) => await this.mediaRoots.getActiveRoot(rootId),
            acquireAll: (refs) => mediaPathOwnership.acquireAll(refs),
            journal: state.repositories.publicationJournal,
            repairIssues: state.repositories.libraryRepairIssues,
            commit: () => state.repositories.library.writeRefresh(refresh),
          });
        },
      },
      events: { publish: async (event) => await this.publishCoordinatorEvent(event) },
      concurrency: 1,
    });
  }

  async start(input: MaintenanceStartInput): Promise<MaintenanceMutationAckDto> {
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    const refs = input.refs?.map((ref) => {
      if (ref.rootId !== input.rootId) throw new Error("维护任务只能包含同一个媒体目录下的文件");
      return { relativePath: ref.relativePath };
    });
    const handle = await this.coordinator.startPreview({ rootId: root.id, presetId: input.presetId, refs });
    void handle.completion.catch(() => undefined);
    return { sessionId: handle.task.id };
  }

  async scanSelectedFiles(input: MaintenanceScanSelectedFilesInput): Promise<MaintenanceScanSelectedFilesResponse> {
    const normalizedScanDir = path.resolve(input.scanDir);
    const roots = (await this.mediaRoots.list()).roots.filter((root) => root.enabled);
    const refsByRootId = new Map<string, Array<{ relativePath: string }>>();

    for (const filePath of input.filePaths) {
      const resolvedPath = path.resolve(filePath);
      const relativeToScan = path.relative(normalizedScanDir, resolvedPath);
      if (!relativeToScan || relativeToScan.startsWith("..") || path.isAbsolute(relativeToScan)) {
        throw new Error(`文件不在扫描目录内：${filePath}`);
      }
      const root = roots.find((candidate) => {
        const relativeToRoot = path.relative(candidate.hostPath, resolvedPath);
        return relativeToRoot && !relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot);
      });
      if (!root) throw new Error(`文件不在已注册媒体目录内：${filePath}`);
      const relativePath = path.relative(root.hostPath, resolvedPath).replace(/\\/gu, "/");
      refsByRootId.set(root.id, [...(refsByRootId.get(root.id) ?? []), { relativePath }]);
    }

    const entries = (
      await Promise.all(
        [...refsByRootId.entries()].map(async ([rootId, refs]) => {
          const root = await this.mediaRoots.getActiveRoot(rootId);
          const scannedEntries = await this.runtime.scanRefs({ root, refs });
          const relativePathByAbsolutePath = new Map(
            refs.map((ref) => [path.resolve(root.hostPath, ref.relativePath), ref.relativePath]),
          );
          return scannedEntries.map((entry) => {
            const relativePath = relativePathByAbsolutePath.get(path.resolve(entry.fileInfo.filePath));
            return {
              ...entry,
              fileId: relativePath ? `${root.id}:${relativePath}` : entry.fileId,
              rootRef: relativePath ? { rootId: root.id, relativePath } : entry.rootRef,
            };
          });
        }),
      )
    ).flat();
    return { entries };
  }

  async apply(input: MaintenanceApplyInput): Promise<MaintenanceMutationAckDto> {
    const session = await this.coordinator.getActiveSession();
    if (!session || session.id !== input.taskId) throw new Error(`维护会话不存在：${input.taskId}`);
    const previews = session.previews;
    const selectedIds = input.previewIds ? new Set(input.previewIds) : null;
    const selected = selectedIds ? previews.filter((preview) => selectedIds.has(preview.id)) : previews;
    if (previews.length === 0) throw new Error("没有可应用的维护预览");
    if (selectedIds && selected.length !== selectedIds.size) throw new Error("部分维护预览不存在或不属于当前任务");
    if (selected.length === 0) throw new Error("请选择要应用的维护预览");
    if (
      selected.some((preview) => preview.proposedCrawlerData) &&
      input.confirmationToken !== `maintenance:${input.taskId}`
    ) {
      throw new Error("维护应用需要确认令牌");
    }
    const fieldsByPreview = new Map((input.selections ?? []).map((item) => [item.previewId, item.fieldSelections]));
    const selections: MaintenanceApplySelection[] = selected.map((preview) => ({
      previewId: preview.id,
      fieldSelections: fieldsByPreview.get(preview.id),
    }));
    const handle = await this.coordinator.beginApply({ taskId: input.taskId, selections });
    void handle.completion.catch(() => undefined);
    return { sessionId: input.taskId };
  }

  async pause(input: MaintenanceTaskInput): Promise<MaintenanceMutationAckDto> {
    const task = await this.coordinator.pause(input.taskId);
    return { sessionId: task.id };
  }

  async resume(input: MaintenanceTaskInput): Promise<MaintenanceMutationAckDto> {
    const task = await this.coordinator.resume(input.taskId);
    return { sessionId: task.id };
  }

  async stop(input: MaintenanceTaskInput): Promise<MaintenanceMutationAckDto> {
    const task = await this.coordinator.stop(input.taskId);
    return { sessionId: task.id };
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
    taskId: string;
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
  }): Promise<MaintenanceMutationAckDto> {
    await this.coordinator.updateDraft(input);
    return { sessionId: input.taskId };
  }

  async discardSession(input?: { taskId?: string }): Promise<MaintenanceMutationAckDto> {
    const sessionId = input?.taskId ?? (await this.coordinator.getActiveSession())?.id ?? "";
    await this.coordinator.discardSession(input?.taskId);
    return { sessionId };
  }

  async close(): Promise<void> {
    await this.coordinator.close();
  }

  private async publishCoordinatorEvent(event: MaintenanceCoordinatorEvent): Promise<void> {
    switch (event.kind) {
      case "task-changed":
        this.taskEvents.lifecycle(await this.toLifecycleEvent(event.task));
        this.taskEvents.invalidate("maintenance");
        return;
      case "log": {
        const dto = toTaskEventDto(event.event);
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
