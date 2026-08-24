import path from "node:path";
import {
  type MaintenanceCoordinatorEvent,
  type MaintenanceRuntime,
  MaintenanceTaskCoordinator,
} from "@mdcz/runtime/maintenance";
import { toMaintenanceClientSession } from "@mdcz/runtime/maintenance/clientSession";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import type {
  MaintenanceApplySelection,
  MaintenanceTaskApplyLog,
  MaintenanceTaskPreview,
} from "@mdcz/shared/maintenanceTasks";
import type {
  LogListResponse,
  MaintenanceApplyInput,
  MaintenanceApplyLogDto,
  MaintenanceApplyResponse,
  MaintenancePreviewItemDto,
  MaintenancePreviewResponse,
  MaintenanceScanSelectedFilesInput,
  MaintenanceScanSelectedFilesResponse,
  MaintenanceStartInput,
  MaintenanceTaskInput,
  ScanTaskDetailResponse,
  ScanTaskDto,
  ScanTaskListResponse,
  TaskEventListResponse,
} from "@mdcz/shared/serverDtos";
import type { LocalScanEntry, MaintenanceClientSession } from "@mdcz/shared/types";
import { createServerMaintenanceRuntime } from "../maintenanceRuntimeFactory";
import { toScanTaskDto, toTaskEventDto } from "../taskDto";
import type { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { decorateTaskLog } from "./runtimeLogService";

const confirmationTokenFor = (taskId: string): string => `maintenance:${taskId}`;
const serverMaintenanceSessionHost = {
  fileId: (preview: MaintenanceTaskPreview): string => `${preview.rootId}:${preview.relativePath}`,
  toEntry: (preview: MaintenanceTaskPreview, fileId: string): LocalScanEntry | null =>
    preview.entry
      ? {
          ...preview.entry,
          fileId,
          rootRef: { rootId: preview.rootId, relativePath: preview.relativePath },
        }
      : null,
};

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
        commitRefresh: async (input) =>
          await (await this.persistence.getState()).repositories.library.commitRefresh(input),
      },
      events: { publish: async (event) => await this.publishCoordinatorEvent(event) },
      concurrency: 1,
    });
  }

  async start(input: MaintenanceStartInput): Promise<ScanTaskDto> {
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    const refs = input.refs?.map((ref) => {
      if (ref.rootId !== input.rootId) throw new Error("维护任务只能包含同一个媒体目录下的文件");
      return { relativePath: ref.relativePath };
    });
    const handle = await this.coordinator.startPreview({ rootId: root.id, presetId: input.presetId, refs });
    void handle.completion.catch(() => undefined);
    return await this.toDto(handle.task.id);
  }

  async list(): Promise<ScanTaskListResponse> {
    const tasks = await this.coordinator.listTasks();
    return { tasks: await Promise.all(tasks.map((task) => this.toDto(task.id))) };
  }

  async detail(taskId: string): Promise<ScanTaskDetailResponse> {
    return { task: await this.toDto(taskId), events: (await this.events(taskId)).events };
  }

  async events(taskId: string): Promise<TaskEventListResponse> {
    return { events: (await this.coordinator.listEvents(taskId)).map(toTaskEventDto) };
  }

  async logs(): Promise<LogListResponse> {
    const tasks = await this.coordinator.listTasks();
    const events = await Promise.all(tasks.map((task) => this.coordinator.listEvents(task.id)));
    return {
      logs: events
        .flat()
        .map((event) => ({ ...toTaskEventDto(event), source: "task" as const }))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    };
  }

  async preview(input: MaintenanceTaskInput): Promise<MaintenancePreviewResponse> {
    const batch = await this.coordinator.waitForPreview(input.taskId);
    return {
      task: await this.toDto(batch.task.id),
      items: await Promise.all(batch.items.map((preview) => this.previewToDto(preview))),
      confirmationToken: confirmationTokenFor(input.taskId),
    };
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

  async apply(input: MaintenanceApplyInput): Promise<MaintenanceApplyResponse> {
    const previews = await this.coordinator.readPreview(input.taskId).then((batch) => batch.items);
    const selectedIds = input.previewIds ? new Set(input.previewIds) : null;
    const selected = selectedIds ? previews.filter((preview) => selectedIds.has(preview.id)) : previews;
    if (previews.length === 0) throw new Error("没有可应用的维护预览");
    if (selectedIds && selected.length !== selectedIds.size) throw new Error("部分维护预览不存在或不属于当前任务");
    if (selected.length === 0) throw new Error("请选择要应用的维护预览");
    if (
      selected.some((preview) => preview.proposedCrawlerData) &&
      input.confirmationToken !== confirmationTokenFor(input.taskId)
    ) {
      throw new Error("维护应用需要确认令牌");
    }
    const fieldsByPreview = new Map((input.selections ?? []).map((item) => [item.previewId, item.fieldSelections]));
    const selections: MaintenanceApplySelection[] = selected.map((preview) => ({
      previewId: preview.id,
      fieldSelections: fieldsByPreview.get(preview.id),
    }));
    const handle = await this.coordinator.beginApply({ taskId: input.taskId, selections });
    const batch = await handle.completion;
    return {
      task: await this.toDto(batch.task.id),
      items: await Promise.all(batch.items.map((preview) => this.previewToDto(preview))),
      applied: batch.applied.map(toApplyLogDto),
    };
  }

  async pause(input: MaintenanceTaskInput): Promise<ScanTaskDto> {
    const task = await this.coordinator.pause(input.taskId);
    return await this.toDto(task.id);
  }

  async resume(input: MaintenanceTaskInput): Promise<ScanTaskDto> {
    const task = await this.coordinator.resume(input.taskId);
    return await this.toDto(task.id);
  }

  async stop(input: MaintenanceTaskInput): Promise<ScanTaskDto> {
    const task = await this.coordinator.stop(input.taskId);
    return await this.toDto(task.id);
  }

  async getActiveSession(): Promise<MaintenanceClientSession | null> {
    return toMaintenanceClientSession(await this.coordinator.getActiveSession(), serverMaintenanceSessionHost);
  }

  async updateDraft(input: {
    taskId: string;
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
    imageSelections?: Record<string, string>;
  }): Promise<{ success: true }> {
    await this.coordinator.updateDraft(input);
    return { success: true };
  }

  async discardSession(input?: { taskId?: string }): Promise<{ success: true }> {
    await this.coordinator.discardSession(input?.taskId);
    return { success: true };
  }

  async close(): Promise<void> {
    await this.coordinator.close();
  }

  private async toDto(taskId: string): Promise<ScanTaskDto> {
    const task = await this.coordinator.getTask(taskId);
    const state = await this.persistence.getState();
    const session = await this.coordinator.getActiveSession();
    if (!session || session.task.id !== taskId) throw new Error(`Maintenance task not found: ${taskId}`);
    const execution = session.execution;
    const previews = await this.coordinator.readPreview(taskId).then((batch) => batch.items);
    const root = await state.repositories.mediaRoots.get(task.rootId, { includeDeleted: true }).catch(() => null);
    const videos =
      previews.length > 0
        ? previews.map((preview) => preview.relativePath)
        : execution.refs.map((ref) => ref.relativePath);
    return toScanTaskDto(
      {
        ...task,
        kind: "maintenance",
        videoCount: task.successCount,
        directoryCount: new Set(videos.map((item) => path.posix.dirname(item))).size,
      },
      { rootDisplayName: root?.displayName ?? "未知媒体目录", videoCount: videos.length, videos },
    );
  }

  private async previewToDto(preview: MaintenanceTaskPreview): Promise<MaintenancePreviewItemDto> {
    const root = await (await this.persistence.getState()).repositories.mediaRoots
      .get(preview.rootId, { includeDeleted: true })
      .catch(() => null);
    return {
      id: preview.id,
      taskId: preview.taskId,
      presetId: preview.presetId,
      rootId: preview.rootId,
      rootDisplayName: root?.displayName ?? "未知媒体目录",
      relativePath: preview.relativePath,
      fileName: path.posix.basename(preview.relativePath),
      status: preview.status,
      error: preview.error,
      fieldDiffs: preview.fieldDiffs as MaintenancePreviewItemDto["fieldDiffs"],
      unchangedFieldDiffs: preview.unchangedFieldDiffs as MaintenancePreviewItemDto["unchangedFieldDiffs"],
      pathDiff: preview.pathDiff,
      proposedCrawlerData: preview.proposedCrawlerData,
      createdAt: preview.createdAt.toISOString(),
      updatedAt: preview.updatedAt.toISOString(),
    };
  }

  private async publishCoordinatorEvent(event: MaintenanceCoordinatorEvent): Promise<void> {
    switch (event.kind) {
      case "task-changed":
        this.taskEvents.publish({ kind: "task", task: await this.toDto(event.task.id) });
        return;
      case "log": {
        const dto = toTaskEventDto(event.event);
        this.taskEvents.publish({ kind: "event", event: dto });
        this.taskEvents.publishRealtime({
          id: dto.id,
          taskId: dto.taskId,
          createdAt: dto.createdAt,
          kind: "log",
          log: decorateTaskLog(dto),
        });
        return;
      }
      case "progress":
        this.taskEvents.publishRealtime({
          id: `${event.taskId}:maintenance-${event.phase}-progress:${event.progress.completedEntries}`,
          taskId: event.taskId,
          createdAt: new Date().toISOString(),
          kind: "task-progress",
          taskKind: "maintenance",
          current: event.progress.completedEntries,
          total: event.progress.totalEntries,
          ...(event.message ? { message: event.message } : {}),
        });
        return;
      case "preview-item": {
        const item = await this.previewToDto(event.preview);
        this.taskEvents.publishRealtime({
          id: `${event.preview.id}:maintenance-preview-item`,
          taskId: event.taskId,
          createdAt: event.preview.updatedAt.toISOString(),
          kind: "maintenance-preview-item",
          item,
        });
        return;
      }
      case "apply-item": {
        const item = toApplyLogDto(event.log);
        this.taskEvents.publishRealtime({
          id: `${event.log.id}:maintenance-apply-item`,
          taskId: event.taskId,
          createdAt: item.appliedAt,
          kind: "maintenance-apply-item",
          item,
        });
        return;
      }
      case "task-failed":
        this.taskEvents.publishRealtime({
          id: `${event.taskId}:maintenance-failed:${Date.now()}`,
          taskId: event.taskId,
          createdAt: new Date().toISOString(),
          kind: "task-failed",
          message: event.error,
          error: event.error,
        });
    }
  }
}

const toApplyLogDto = (log: MaintenanceTaskApplyLog): MaintenanceApplyLogDto => ({
  ...log,
  appliedAt: log.appliedAt.toISOString(),
});
