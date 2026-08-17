import path from "node:path";
import { statRootPath } from "@mdcz/media-store";
import type { MaintenancePreviewRecord } from "@mdcz/persistence";
import {
  MaintenanceExecutor,
  type MaintenanceRuntime,
  toMaintenanceApplyLogDto,
  toMaintenancePreviewDto,
} from "@mdcz/runtime/maintenance";
import {
  type RuntimeTaskAction,
  RuntimeTaskQueueRunner,
  toRuntimeTaskSnapshot,
  toServerTaskStatus,
  transitionTask,
} from "@mdcz/runtime/tasks";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import type {
  CrawlerDataDto,
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
  TaskEventDto,
  TaskEventListResponse,
} from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import { createServerMaintenanceRuntime } from "../maintenanceRuntimeFactory";
import { toScanTaskDto, toTaskEventDto } from "../taskDto";
import type { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { decorateTaskLog } from "./runtimeLogService";

const confirmationTokenFor = (taskId: string): string => `maintenance:${taskId}`;

export class MaintenanceService {
  #stopRequested = new Set<string>();
  #paused = new Set<string>();
  #pendingRefs = new Map<string, Array<{ relativePath: string }>>();
  #pendingPresets = new Map<string, MaintenancePresetId>();
  #executors = new Map<string, MaintenanceExecutor>();
  private readonly runtime: MaintenanceRuntime;
  private readonly runner: RuntimeTaskQueueRunner<{ id: string; presetId: MaintenancePresetId }>;

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    config: ServerConfigService,
    private readonly taskEvents: TaskEventBus,
    runtime?: MaintenanceRuntime,
    mappingStore?: TranslationMappingStore,
  ) {
    this.runtime = runtime ?? createServerMaintenanceRuntime(config, mappingStore);
    this.runner = new RuntimeTaskQueueRunner({
      getNextTask: async () => {
        const task = await (await this.persistence.getState()).repositories.tasks.nextQueued("maintenance");
        if (!task) {
          return null;
        }
        return {
          id: task.id,
          presetId: await this.resolveTaskPreset(task.id, "read_local"),
        };
      },
      runTask: async (task) => {
        await this.runTask(task.id, task.presetId);
      },
    });
  }

  async start(input: MaintenanceStartInput): Promise<ScanTaskDto> {
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    const refs = input.refs?.length
      ? input.refs.map((ref) => {
          if (ref.rootId !== input.rootId) {
            throw new Error("维护任务只能包含同一个媒体目录下的文件");
          }
          return { relativePath: ref.relativePath };
        })
      : undefined;
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.createTask({ kind: "maintenance", rootId: root.id });
    if (refs) {
      this.#pendingRefs.set(task.id, refs);
      for (const ref of refs) {
        await state.repositories.maintenance.upsertPreview({
          taskId: task.id,
          rootId: root.id,
          relativePath: ref.relativePath,
          presetId: input.presetId,
          status: "ready",
        });
      }
    }
    this.#pendingPresets.set(task.id, input.presetId);
    await this.addEvent(task.id, "queued", `Maintenance task queued. Preset: ${input.presetId}`);
    await this.addEvent(task.id, "preset", `Maintenance preset: ${input.presetId}`);
    this.taskEvents.publish({ kind: "task", task: await this.toDto(task.id) });
    this.drain(input.presetId);
    return await this.toDto(task.id);
  }

  async list(): Promise<ScanTaskListResponse> {
    const tasks = await (await this.persistence.getState()).repositories.tasks.list("maintenance");
    return { tasks: await Promise.all(tasks.map((task) => this.toDto(task.id))) };
  }

  async detail(taskId: string): Promise<ScanTaskDetailResponse> {
    return { task: await this.toDto(taskId), events: (await this.events(taskId)).events };
  }

  async events(taskId: string): Promise<TaskEventListResponse> {
    const events = await (await this.persistence.getState()).repositories.tasks.listEvents(taskId);
    return { events: events.map(toTaskEventDto) };
  }

  async logs(): Promise<LogListResponse> {
    const state = await this.persistence.getState();
    const tasks = await state.repositories.tasks.list("maintenance");
    const events = await Promise.all(tasks.map((task) => state.repositories.tasks.listEvents(task.id)));
    const logs = events
      .flat()
      .map((event) => ({ ...toTaskEventDto(event), source: "task" as const }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { logs };
  }

  async preview(input: MaintenanceTaskInput): Promise<MaintenancePreviewResponse> {
    const items = await this.listPreviewDtos(input.taskId);
    return {
      task: await this.toDto(input.taskId),
      items,
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
      if (!root) {
        throw new Error(`文件不在已注册媒体目录内：${filePath}`);
      }

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
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(input.taskId);
    const allPreviews = await state.repositories.maintenance.listPreviews(input.taskId);
    const selectedPreviewIds = input.previewIds ? new Set(input.previewIds) : null;
    const previews = selectedPreviewIds
      ? allPreviews.filter((preview) => selectedPreviewIds.has(preview.id))
      : allPreviews;
    const selectionsByPreviewId = new Map(
      (input.selections ?? []).map((selection) => [selection.previewId, selection.fieldSelections ?? {}]),
    );
    if (allPreviews.length === 0) {
      throw new Error("没有可应用的维护预览");
    }
    if (selectedPreviewIds && previews.length !== selectedPreviewIds.size) {
      throw new Error("部分维护预览不存在或不属于当前任务");
    }
    if (previews.length === 0) {
      throw new Error("请选择要应用的维护预览");
    }
    if (
      previews.some((item) => item.proposedCrawlerDataJson) &&
      input.confirmationToken !== confirmationTokenFor(input.taskId)
    ) {
      throw new Error("维护应用需要确认令牌");
    }
    if (task.status === "running" || task.status === "queued") {
      throw new Error("维护预览生成完成后才能应用");
    }

    await state.repositories.tasks.patch(input.taskId, {
      status: "running",
      startedAt: task.startedAt ?? new Date(),
      completedAt: null,
      error: null,
    });
    const presetId = (previews[0]?.presetId as MaintenancePresetId | undefined) ?? "read_local";
    await this.addEvent(
      input.taskId,
      "running",
      `Starting maintenance run for preset ${presetId}. Items: ${previews.length}`,
    );
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });

    const applied: MaintenanceApplyLogDto[] = [];
    const executor = new MaintenanceExecutor();
    this.#executors.set(input.taskId, executor);
    try {
      await executor.run<MaintenancePreviewRecord, MaintenanceApplyLogDto>({
        state: "executing",
        items: previews,
        concurrency: 1,
        runItem: async (preview, index, signal) => {
          if (this.#stopRequested.has(input.taskId)) {
            return {
              status: "skipped",
              result: await this.recordSkippedMaintenanceApply(input.taskId, preview, "维护已停止"),
            };
          }
          if (this.#paused.has(input.taskId)) {
            return {
              status: "skipped",
              result: await this.recordSkippedMaintenanceApply(input.taskId, preview, "维护已暂停"),
            };
          }
          if (preview.status !== "ready") {
            return {
              status: "skipped",
              result: await this.recordSkippedMaintenanceApply(input.taskId, preview, preview.error),
            };
          }
          const root = await this.mediaRoots.getActiveRoot(preview.rootId);
          const applyResult = await this.runtime.apply({
            presetId: preview.presetId as MaintenancePresetId,
            root,
            progress: { fileIndex: index + 1, totalFiles: previews.length },
            signalService: this.createTaskSignalService(input.taskId, preview.relativePath),
            signal,
            preview: {
              relativePath: preview.relativePath,
              fieldDiffs: JSON.parse(preview.fieldDiffsJson),
              fieldSelections: selectionsByPreviewId.get(preview.id),
              proposedCrawlerData: preview.proposedCrawlerDataJson
                ? parseCrawlerData(preview.proposedCrawlerDataJson)
                : null,
            },
          });
          if (applyResult.status === "failed") {
            throw new Error(applyResult.error);
          }
          const crawlerData =
            applyResult.crawlerData ??
            (preview.proposedCrawlerDataJson ? parseCrawlerData(preview.proposedCrawlerDataJson) : null);
          const outputRelativePath = applyResult.outputRelativePath || preview.relativePath;
          if (crawlerData) {
            const file = await statRootPath(root, outputRelativePath);
            await state.repositories.library.upsertEntry({
              rootId: preview.rootId,
              rootRelativePath: outputRelativePath,
              mediaIdentity: crawlerData.number,
              size: file.size,
              modifiedAt: file.modifiedAt,
              sourceTaskId: input.taskId,
              title: crawlerData.title,
              number: crawlerData.number,
              actors: crawlerData.actors,
              crawlerDataJson: JSON.stringify(crawlerData),
              thumbnailPath: crawlerData.thumb_url ?? crawlerData.poster_url ?? null,
              lastKnownPath: outputRelativePath,
            });
          }
          await state.repositories.maintenance.upsertPreview({ ...preview, status: "applied" });
          const log = await state.repositories.maintenance.addApplyLog({
            taskId: input.taskId,
            previewId: preview.id,
            rootId: preview.rootId,
            relativePath: preview.relativePath,
            presetId: preview.presetId,
            status: "success",
          });
          const item = toMaintenanceApplyLogDto(log);
          await this.addEvent(input.taskId, "item-success", `Applied maintenance item: ${preview.relativePath}`);
          this.taskEvents.publishRealtime({
            id: `${log.id}:maintenance-apply-item`,
            taskId: input.taskId,
            createdAt: item.appliedAt,
            kind: "maintenance-apply-item",
            item,
          });
          return { status: "success", result: item };
        },
        callbacks: {
          onItemComplete: async (preview, index, itemResult) => {
            this.taskEvents.publishRealtime({
              id: `${input.taskId}:maintenance-apply-progress:${index + 1}`,
              taskId: input.taskId,
              createdAt: new Date().toISOString(),
              kind: "task-progress",
              taskKind: "maintenance",
              current: index + 1,
              total: previews.length,
              message: preview.relativePath,
            });
            if (itemResult.result) {
              applied.push(itemResult.result);
            }
            if (itemResult.status === "failed") {
              const message = itemResult.error ?? "维护应用失败";
              await state.repositories.maintenance.upsertPreview({ ...preview, status: "failed", error: message });
              const log = await state.repositories.maintenance.addApplyLog({
                taskId: input.taskId,
                previewId: preview.id,
                rootId: preview.rootId,
                relativePath: preview.relativePath,
                presetId: preview.presetId,
                status: "failed",
                error: message,
              });
              const item = toMaintenanceApplyLogDto(log);
              applied.push(item);
              await this.addEvent(input.taskId, "item-failed", `${preview.relativePath}: ${message}`);
              this.taskEvents.publishRealtime({
                id: `${log.id}:maintenance-apply-item`,
                taskId: input.taskId,
                createdAt: item.appliedAt,
                kind: "maintenance-apply-item",
                item,
              });
            }
          },
        },
      });
      const successCount = applied.filter((item) => item.status === "success").length;
      const failedCount = applied.filter((item) => item.status === "failed").length;
      await state.repositories.tasks.patch(input.taskId, {
        status: failedCount > 0 && successCount === 0 ? "failed" : "completed",
        completedAt: new Date(),
        videoCount: successCount,
        error: failedCount > 0 && successCount === 0 ? "维护应用失败" : null,
      });
      await this.addEvent(
        input.taskId,
        "completed",
        `Maintenance completed. Succeeded: ${successCount}, Failed: ${failedCount}`,
      );
      this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
      return { task: await this.toDto(input.taskId), items: await this.listPreviewDtos(input.taskId), applied };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.transitionTask(input.taskId, "fail", message);
      await this.addEvent(input.taskId, "failed", message);
      this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
      throw error;
    } finally {
      this.#executors.delete(input.taskId);
    }
  }

  async pause(input: MaintenanceTaskInput): Promise<ScanTaskDto> {
    this.#paused.add(input.taskId);
    this.#executors.get(input.taskId)?.pause();
    await this.transitionTask(input.taskId, "pause");
    await this.addEvent(input.taskId, "paused", "Maintenance task paused");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    return await this.toDto(input.taskId);
  }

  async stop(input: MaintenanceTaskInput): Promise<ScanTaskDto> {
    this.#stopRequested.add(input.taskId);
    this.#executors.get(input.taskId)?.stop();
    this.#paused.delete(input.taskId);
    await this.transitionTask(input.taskId, "stop", "维护已停止");
    await this.addEvent(input.taskId, "stopping", "Stopping maintenance task");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    return await this.toDto(input.taskId);
  }

  async resume(input: MaintenanceTaskInput): Promise<ScanTaskDto> {
    this.#paused.delete(input.taskId);
    this.#executors.get(input.taskId)?.resume();
    await this.transitionTask(input.taskId, "resume");
    await this.addEvent(input.taskId, "queued", "Maintenance task resumed and requeued");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    this.drain(await this.resolveTaskPreset(input.taskId, "read_local"));
    return await this.toDto(input.taskId);
  }

  async resumeQueued(): Promise<void> {
    await (await this.persistence.getState()).repositories.tasks.requeueRunning("maintenance");
    this.drain("read_local");
  }

  private drain(defaultPresetId: MaintenancePresetId): void {
    void defaultPresetId;
    this.runner.drain();
  }

  private async runTask(taskId: string, presetId: MaintenancePresetId): Promise<void> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    const persistedPreviews = await state.repositories.maintenance.listPreviews(taskId);
    const refs =
      this.#pendingRefs.get(taskId) ??
      (persistedPreviews.length > 0
        ? persistedPreviews.map((preview) => ({ relativePath: preview.relativePath }))
        : undefined);
    await this.transitionTask(taskId, "start");
    await this.addEvent(
      taskId,
      "running",
      refs?.length ? "Scanning selected maintenance files" : "Scanning maintenance directories",
    );
    this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });

    try {
      const root = await this.mediaRoots.getActiveRoot(task.rootId);
      await state.repositories.maintenance.deletePreviewsForTask(taskId);
      const entries = await (refs?.length ? this.runtime.scanRefs({ root, refs }) : this.runtime.scan({ root }));
      await this.addEvent(taskId, "log", `Maintenance scan completed. Found ${entries.length} item(s).`);
      const executor = new MaintenanceExecutor();
      this.#executors.set(taskId, executor);
      type PreviewEntry = (typeof entries)[number];
      type PreviewItem = Awaited<ReturnType<MaintenanceRuntime["previewEntries"]>>[number];
      const items = await executor.run<PreviewEntry, PreviewItem>({
        state: "previewing",
        items: entries,
        concurrency: 1,
        runItem: async (entry, _index, signal) => {
          if (this.#stopRequested.has(taskId)) {
            return { status: "skipped", error: "维护已停止" };
          }
          if (this.#paused.has(taskId)) {
            await this.transitionTask(taskId, "pause");
            await this.addEvent(taskId, "paused", "Maintenance task paused");
            this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
            return { status: "skipped", error: "维护已暂停" };
          }
          const [item] = await this.runtime.previewEntries({ root, presetId, entries: [entry], signal });
          if (!item) {
            return { status: "failed", error: "维护预览未返回结果" };
          }
          return {
            status: item.status === "ready" ? "success" : "failed",
            result: item,
            error: item.error ?? undefined,
          };
        },
        callbacks: {
          onItemComplete: async (_entry, index, result) => {
            this.taskEvents.publishRealtime({
              id: `${taskId}:maintenance-preview-progress:${index + 1}`,
              taskId,
              createdAt: new Date().toISOString(),
              kind: "task-progress",
              taskKind: "maintenance",
              current: index + 1,
              total: entries.length,
              ...(result.result ? { message: result.result.relativePath } : {}),
            });
            const item = result.result;
            if (!item) {
              return;
            }
            const preview = await state.repositories.maintenance.upsertPreview({
              taskId,
              rootId: item.rootId,
              relativePath: item.relativePath,
              presetId,
              status: item.status,
              error: item.error,
              fieldDiffsJson: JSON.stringify(item.fieldDiffs),
              unchangedFieldDiffsJson: JSON.stringify(item.unchangedFieldDiffs),
              pathDiffJson: item.pathDiff ? JSON.stringify(item.pathDiff) : null,
              proposedCrawlerDataJson: item.proposedCrawlerData ? JSON.stringify(item.proposedCrawlerData) : null,
            });
            await this.addEvent(taskId, item.status === "ready" ? "item-ready" : "item-blocked", item.relativePath);
            const previewItem = await this.previewToDto(preview);
            this.taskEvents.publishRealtime({
              id: `${previewItem.id}:maintenance-preview-item:${previewItem.updatedAt}`,
              taskId,
              createdAt: previewItem.updatedAt,
              kind: "maintenance-preview-item",
              item: previewItem,
            });
          },
        },
      });
      if (this.#paused.has(taskId)) {
        return;
      }
      const readyCount = items.filter((item) => item.status === "ready").length;
      const blockedCount = items.filter((item) => item.status === "blocked").length;
      await state.repositories.tasks.patch(taskId, {
        status: blockedCount > 0 && readyCount === 0 ? "failed" : "completed",
        completedAt: new Date(),
        videoCount: readyCount,
        directoryCount: new Set(items.map((item) => path.posix.dirname(item.relativePath))).size,
        error: blockedCount > 0 && readyCount === 0 ? "维护预览全部失败" : null,
      });
      await this.addEvent(
        taskId,
        "completed",
        `Maintenance preview completed. Ready: ${readyCount}, Blocked: ${blockedCount}`,
      );
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.transitionTask(taskId, "fail", message);
      await this.addEvent(taskId, "failed", message);
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    } finally {
      this.#executors.delete(taskId);
      this.#pendingRefs.delete(taskId);
      this.#pendingPresets.delete(taskId);
      this.#stopRequested.delete(taskId);
    }
  }

  private async resolveTaskPreset(taskId: string, fallback: MaintenancePresetId): Promise<MaintenancePresetId> {
    const previews = await (await this.persistence.getState()).repositories.maintenance.listPreviews(taskId);
    const eventPreset = (await this.events(taskId)).events
      .find((event) => event.type === "preset")
      ?.message.replace(/^(Maintenance preset: |维护预设：)/u, "") as MaintenancePresetId | undefined;
    return (
      (previews[0]?.presetId as MaintenancePresetId | undefined) ??
      this.#pendingPresets.get(taskId) ??
      eventPreset ??
      fallback
    );
  }

  private async recordSkippedMaintenanceApply(
    taskId: string,
    preview: MaintenancePreviewRecord,
    error: string | null,
  ): Promise<MaintenanceApplyLogDto> {
    const log = await (await this.persistence.getState()).repositories.maintenance.addApplyLog({
      taskId,
      previewId: preview.id,
      rootId: preview.rootId,
      relativePath: preview.relativePath,
      presetId: preview.presetId,
      status: "skipped",
      error,
    });
    const item = toMaintenanceApplyLogDto(log);
    this.taskEvents.publishRealtime({
      id: `${item.id}:maintenance-apply-item`,
      taskId,
      createdAt: item.appliedAt,
      kind: "maintenance-apply-item",
      item,
    });
    return item;
  }

  private async listPreviewDtos(taskId: string): Promise<MaintenancePreviewItemDto[]> {
    const previews = await (await this.persistence.getState()).repositories.maintenance.listPreviews(taskId);
    return await Promise.all(previews.map((preview) => this.previewToDto(preview)));
  }

  private async toDto(taskId: string): Promise<ScanTaskDto> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    const root = await state.repositories.mediaRoots.get(task.rootId, { includeDeleted: true }).catch(() => null);
    const previews = await state.repositories.maintenance.listPreviews(taskId);
    return toScanTaskDto(task, {
      rootDisplayName: root?.displayName ?? "未知媒体目录",
      videoCount: task.videoCount || previews.length,
      videos: previews.map((preview) => preview.relativePath),
    });
  }

  private async previewToDto(record: MaintenancePreviewRecord): Promise<MaintenancePreviewItemDto> {
    const root = await (await this.persistence.getState()).repositories.mediaRoots
      .get(record.rootId, { includeDeleted: true })
      .catch(() => null);
    return toMaintenancePreviewDto(record, {
      rootDisplayName: root?.displayName ?? "未知媒体目录",
    });
  }

  private async transitionTask(taskId: string, action: RuntimeTaskAction, error?: string | null): Promise<void> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    const next = transitionTask(toRuntimeTaskSnapshot(task), { action, error });
    await state.repositories.tasks.patch(taskId, {
      status: toServerTaskStatus(next.status),
      startedAt: next.startedAt,
      completedAt: next.completedAt,
      error: next.error,
    });
  }

  private async addEvent(taskId: string, type: string, message: string): Promise<TaskEventDto> {
    const event = await (await this.persistence.getState()).repositories.tasks.addEvent({ taskId, type, message });
    const dto = toTaskEventDto(event);
    this.taskEvents.publish({ kind: "event", event: dto });
    this.taskEvents.publishRealtime({
      id: dto.id,
      taskId: dto.taskId,
      createdAt: dto.createdAt,
      kind: "log",
      log: decorateTaskLog(dto),
    });
    if (type === "failed") {
      this.taskEvents.publishRealtime({
        id: `${dto.id}:failed`,
        taskId: dto.taskId,
        createdAt: dto.createdAt,
        kind: "task-failed",
        message,
        error: message,
      });
    }
    return dto;
  }

  private createTaskSignalService(
    taskId: string,
    message?: string,
  ): {
    setProgress(value: number, current: number, total: number): void;
    showLogText(message: string): void;
  } {
    return {
      setProgress: (value, current, total) => {
        const createdAt = new Date().toISOString();
        this.taskEvents.publishRealtime({
          id: `${taskId}:maintenance-runtime-progress:${current}:${value}:${createdAt}`,
          taskId,
          createdAt,
          kind: "task-progress",
          taskKind: "maintenance",
          value,
          current,
          total,
          ...(message ? { message } : {}),
        });
      },
      showLogText: (logMessage) => {
        void this.addEvent(taskId, "log", logMessage);
      },
    };
  }
}

const parseCrawlerData = (value: string): CrawlerDataDto => JSON.parse(value) as CrawlerDataDto;
