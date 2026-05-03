import path from "node:path";
import type { MaintenanceApplyLogRecord, MaintenancePreviewRecord, TaskRecordStatus } from "@mdcz/persistence";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import { FetchNetworkClient } from "@mdcz/runtime/network";
import {
  ActorImageService,
  AggregationService,
  DownloadManager,
  FileOrganizer,
  NfoGenerator,
  TranslateService,
} from "@mdcz/runtime/scrape";
import { type RuntimeTaskAction, type RuntimeTaskStatus, transitionTask } from "@mdcz/runtime/tasks";
import type {
  CrawlerDataDto,
  LogListResponse,
  MaintenanceApplyInput,
  MaintenanceApplyLogDto,
  MaintenanceApplyResponse,
  MaintenancePreviewItemDto,
  MaintenancePreviewResponse,
  MaintenanceStartInput,
  MaintenanceTaskInput,
  ScanTaskDetailResponse,
  ScanTaskDto,
  ScanTaskListResponse,
  TaskEventDto,
  TaskEventListResponse,
} from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import { statRootPath } from "@mdcz/storage";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import type { TaskEventBus } from "./taskEvents";

const toIso = (value: Date | null): string | null => value?.toISOString() ?? null;
const confirmationTokenFor = (taskId: string): string => `maintenance:${taskId}`;

class MemoryImageHostCooldownStore {
  private readonly entries = new Map<string, { failures: number[]; cooldownUntil?: number }>();

  getActiveCooldown(key: string): { cooldownUntil: number; remainingMs: number } | null {
    const cooldownUntil = this.entries.get(key)?.cooldownUntil;
    if (!cooldownUntil) return null;
    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs <= 0) {
      this.reset(key);
      return null;
    }
    return { cooldownUntil, remainingMs };
  }

  isCoolingDown(key: string): boolean {
    return this.getActiveCooldown(key) !== null;
  }

  recordFailure(
    key: string,
    policy: { threshold: number; windowMs: number; cooldownMs: number },
  ): { cooldownUntil?: number | null; failureCount: number } {
    const now = Date.now();
    const entry = this.entries.get(key) ?? { failures: [] };
    const failures = [...entry.failures.filter((timestamp) => now - timestamp <= policy.windowMs), now];
    const cooldownUntil = failures.length >= policy.threshold ? now + policy.cooldownMs : entry.cooldownUntil;
    this.entries.set(key, { failures, cooldownUntil });
    return { cooldownUntil, failureCount: failures.length };
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

const createServerMaintenanceRuntime = (config: ServerConfigService): MaintenanceRuntime => {
  const networkClient = new FetchNetworkClient();
  const logger = console;
  return new MaintenanceRuntime({
    actorImageService: new ActorImageService({
      cacheRoot: path.join(config.runtimePaths.dataDir, "actor-image-cache"),
      networkClient,
    }),
    aggregationService: new AggregationService(new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) })),
    config,
    downloadManager: new DownloadManager(networkClient, {
      imageHostCooldownStore: new MemoryImageHostCooldownStore(),
      logger,
    }),
    fileOrganizer: new FileOrganizer(logger),
    nfoGenerator: new NfoGenerator(),
    signalService: {
      setProgress: () => undefined,
      showLogText: () => undefined,
    },
    translateService: new TranslateService(networkClient, { logger }),
  });
};

export class MaintenanceService {
  #running = false;
  #stopRequested = new Set<string>();
  #paused = new Set<string>();
  #pendingRefs = new Map<string, Array<{ relativePath: string }>>();
  #pendingPresets = new Map<string, MaintenancePresetId>();

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    config: ServerConfigService,
    private readonly taskEvents: TaskEventBus,
    private readonly runtime = createServerMaintenanceRuntime(config),
  ) {}

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
    await this.addEvent(task.id, "queued", `维护任务已排队：${input.presetId}`);
    await this.addEvent(task.id, "preset", `维护预设：${input.presetId}`);
    this.taskEvents.publish({ kind: "task", task: await this.toDto(task.id) });
    void this.drain(input.presetId);
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
    const tasks = (await this.list()).tasks;
    const events = await Promise.all(tasks.map((task) => this.events(task.id)));
    const logs = events
      .flatMap((eventList) => eventList.events)
      .map((event) => ({ ...event, source: "task" as const }))
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
    await this.addEvent(input.taskId, "running", "开始应用维护预览");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });

    const applied: MaintenanceApplyLogDto[] = [];
    let successCount = 0;
    let failedCount = 0;
    try {
      for (const preview of previews) {
        if (preview.status !== "ready") {
          const skipped = await state.repositories.maintenance.addApplyLog({
            taskId: input.taskId,
            previewId: preview.id,
            rootId: preview.rootId,
            relativePath: preview.relativePath,
            presetId: preview.presetId,
            status: "skipped",
            error: preview.error,
          });
          applied.push(toApplyLogDto(skipped));
          continue;
        }
        try {
          const root = await this.mediaRoots.getActiveRoot(preview.rootId);
          await this.runtime.apply({
            presetId: preview.presetId as MaintenancePresetId,
            root,
            preview: {
              relativePath: preview.relativePath,
              fieldDiffs: JSON.parse(preview.fieldDiffsJson),
              fieldSelections: selectionsByPreviewId.get(preview.id),
              proposedCrawlerData: preview.proposedCrawlerDataJson
                ? parseCrawlerData(preview.proposedCrawlerDataJson)
                : null,
            },
          });
          const crawlerData = preview.proposedCrawlerDataJson
            ? parseCrawlerData(preview.proposedCrawlerDataJson)
            : null;
          if (crawlerData) {
            const file = await statRootPath(root, preview.relativePath);
            await state.repositories.library.upsertEntry({
              rootId: preview.rootId,
              rootRelativePath: preview.relativePath,
              mediaIdentity: crawlerData.number,
              size: file.size,
              modifiedAt: file.modifiedAt,
              sourceTaskId: input.taskId,
              title: crawlerData.title,
              number: crawlerData.number,
              actors: crawlerData.actors,
              crawlerDataJson: JSON.stringify(crawlerData),
              thumbnailPath: crawlerData.thumb_url ?? crawlerData.poster_url ?? null,
              lastKnownPath: preview.relativePath,
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
          applied.push(toApplyLogDto(log));
          successCount += 1;
          await this.addEvent(input.taskId, "item-success", `已应用维护项：${preview.relativePath}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
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
          applied.push(toApplyLogDto(log));
          failedCount += 1;
          await this.addEvent(input.taskId, "item-failed", `${preview.relativePath}: ${message}`);
        }
      }
      await state.repositories.tasks.patch(input.taskId, {
        status: failedCount > 0 && successCount === 0 ? "failed" : "completed",
        completedAt: new Date(),
        videoCount: successCount,
        error: failedCount > 0 && successCount === 0 ? "维护应用失败" : null,
      });
      await this.addEvent(input.taskId, "completed", `维护应用完成：${successCount} 成功，${failedCount} 失败`);
      this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
      return { task: await this.toDto(input.taskId), items: await this.listPreviewDtos(input.taskId), applied };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.transitionTask(input.taskId, "fail", message);
      await this.addEvent(input.taskId, "failed", message);
      this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
      throw error;
    }
  }

  async pause(input: MaintenanceTaskInput): Promise<ScanTaskDto> {
    this.#paused.add(input.taskId);
    await this.transitionTask(input.taskId, "pause");
    await this.addEvent(input.taskId, "paused", "维护任务已暂停");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    return await this.toDto(input.taskId);
  }

  async stop(input: MaintenanceTaskInput): Promise<ScanTaskDto> {
    this.#stopRequested.add(input.taskId);
    this.#paused.delete(input.taskId);
    await this.transitionTask(input.taskId, "stop", "维护已停止");
    await this.addEvent(input.taskId, "stopping", "正在停止维护任务");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    return await this.toDto(input.taskId);
  }

  async resume(input: MaintenanceTaskInput): Promise<ScanTaskDto> {
    this.#paused.delete(input.taskId);
    await this.transitionTask(input.taskId, "resume");
    await this.addEvent(input.taskId, "queued", "维护任务已恢复排队");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(input.taskId) });
    void this.drain(await this.resolveTaskPreset(input.taskId, "read_local"));
    return await this.toDto(input.taskId);
  }

  async resumeQueued(): Promise<void> {
    await (await this.persistence.getState()).repositories.tasks.requeueRunning("maintenance");
    void this.drain("read_local");
  }

  private async drain(defaultPresetId: MaintenancePresetId): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (true) {
        const state = await this.persistence.getState();
        const task = await state.repositories.tasks.nextQueued("maintenance");
        if (!task) return;
        const presetId = await this.resolveTaskPreset(task.id, defaultPresetId);
        await this.runTask(task.id, presetId);
      }
    } finally {
      this.#running = false;
    }
  }

  private async runTask(taskId: string, presetId: MaintenancePresetId): Promise<void> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    await this.transitionTask(taskId, "start");
    await this.addEvent(taskId, "running", "开始生成维护预览");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });

    try {
      const root = await this.mediaRoots.getActiveRoot(task.rootId);
      const persistedPreviews = await state.repositories.maintenance.listPreviews(taskId);
      const refs =
        this.#pendingRefs.get(taskId) ??
        (persistedPreviews.length > 0
          ? persistedPreviews.map((preview) => ({ relativePath: preview.relativePath }))
          : undefined);
      await state.repositories.maintenance.deletePreviewsForTask(taskId);
      const items = await this.runtime.preview({ root, presetId, refs });
      let readyCount = 0;
      let blockedCount = 0;
      for (const item of items) {
        if (this.#stopRequested.has(taskId)) {
          throw new Error("维护已停止");
        }
        if (this.#paused.has(taskId)) {
          await this.transitionTask(taskId, "pause");
          await this.addEvent(taskId, "paused", "维护任务已暂停");
          this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
          return;
        }
        readyCount += item.status === "ready" ? 1 : 0;
        blockedCount += item.status === "blocked" ? 1 : 0;
        await state.repositories.maintenance.upsertPreview({
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
      }
      await state.repositories.tasks.patch(taskId, {
        status: blockedCount > 0 && readyCount === 0 ? "failed" : "completed",
        completedAt: new Date(),
        videoCount: readyCount,
        directoryCount: new Set(items.map((item) => path.posix.dirname(item.relativePath))).size,
        error: blockedCount > 0 && readyCount === 0 ? "维护预览全部失败" : null,
      });
      await this.addEvent(taskId, "completed", `维护预览完成：${readyCount} 可应用，${blockedCount} 阻塞`);
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.transitionTask(taskId, "fail", message);
      await this.addEvent(taskId, "failed", message);
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    } finally {
      this.#pendingRefs.delete(taskId);
      this.#pendingPresets.delete(taskId);
      this.#stopRequested.delete(taskId);
    }
  }

  private async resolveTaskPreset(taskId: string, fallback: MaintenancePresetId): Promise<MaintenancePresetId> {
    const previews = await (await this.persistence.getState()).repositories.maintenance.listPreviews(taskId);
    const eventPreset = (await this.events(taskId)).events
      .find((event) => event.type === "preset")
      ?.message.replace(/^维护预设：/u, "") as MaintenancePresetId | undefined;
    return (
      (previews[0]?.presetId as MaintenancePresetId | undefined) ??
      this.#pendingPresets.get(taskId) ??
      eventPreset ??
      fallback
    );
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
    return {
      id: task.id,
      kind: task.kind,
      rootId: task.rootId,
      rootDisplayName: root?.displayName ?? "未知媒体目录",
      status: task.status,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      startedAt: toIso(task.startedAt),
      completedAt: toIso(task.completedAt),
      videoCount: task.videoCount || previews.length,
      directoryCount: task.directoryCount,
      error: task.error,
      videos: previews.map((preview) => preview.relativePath),
    };
  }

  private async previewToDto(record: MaintenancePreviewRecord): Promise<MaintenancePreviewItemDto> {
    const root = await (await this.persistence.getState()).repositories.mediaRoots
      .get(record.rootId, { includeDeleted: true })
      .catch(() => null);
    return {
      id: record.id,
      taskId: record.taskId,
      presetId: record.presetId as MaintenancePresetId,
      rootId: record.rootId,
      rootDisplayName: root?.displayName ?? "未知媒体目录",
      relativePath: record.relativePath,
      fileName: path.posix.basename(record.relativePath),
      status: record.status,
      error: record.error,
      fieldDiffs: JSON.parse(record.fieldDiffsJson),
      unchangedFieldDiffs: JSON.parse(record.unchangedFieldDiffsJson),
      pathDiff: record.pathDiffJson ? JSON.parse(record.pathDiffJson) : null,
      proposedCrawlerData: record.proposedCrawlerDataJson ? JSON.parse(record.proposedCrawlerDataJson) : null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
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
    return dto;
  }
}

const toTaskEventDto = (event: {
  id: string;
  taskId: string;
  type: string;
  message: string;
  createdAt: Date;
}): TaskEventDto => ({
  id: event.id,
  taskId: event.taskId,
  type: event.type,
  message: event.message,
  createdAt: event.createdAt.toISOString(),
});

const toApplyLogDto = (record: MaintenanceApplyLogRecord): MaintenanceApplyLogDto => ({
  id: record.id,
  taskId: record.taskId,
  previewId: record.previewId,
  rootId: record.rootId,
  relativePath: record.relativePath,
  presetId: record.presetId as MaintenancePresetId,
  status: record.status,
  error: record.error,
  appliedAt: record.appliedAt.toISOString(),
});

const parseCrawlerData = (value: string): CrawlerDataDto => JSON.parse(value) as CrawlerDataDto;

const toRuntimeTaskSnapshot = (task: {
  id: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}) => ({
  id: task.id,
  status: task.status as RuntimeTaskStatus,
  startedAt: task.startedAt,
  completedAt: task.completedAt,
  error: task.error,
});

const toServerTaskStatus = (status: RuntimeTaskStatus): TaskRecordStatus => {
  return status === "canceled" ? "failed" : status;
};
