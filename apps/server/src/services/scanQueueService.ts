import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  filesystemPathKey,
  listRootFiles,
  type MediaRoot,
  normalizeHostPath,
  resolveRootFile,
  toRootRelativePath,
} from "@mdcz/media-store";
import type { ScanTask } from "@mdcz/persistence";
import { registeredOutputPaths } from "@mdcz/runtime";
import { createMediaFileFilter } from "@mdcz/runtime/scrape";
import { CandidatePreview, TaskScheduler } from "@mdcz/runtime/tasks";
import type {
  LogListResponse,
  ScanCandidatesInput,
  ScanCandidatesResponse,
  ScanTaskDetailResponse,
  ScanTaskDto,
  ScanTaskListResponse,
  TaskEventDto,
  TaskEventListResponse,
} from "@mdcz/shared/serverDtos";
import { isPrimaryVideoFileName } from "@mdcz/shared/videoClassification";
import { toTaskEventDto } from "../taskDto";
import type { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { decorateTaskLog } from "./runtimeLogService";

interface ScanFileResult {
  relativePath: string;
  size: number;
  modifiedAt: Date | null;
}

interface ScanDirectoryResult {
  videos: ScanFileResult[];
  directoryCount: number;
}

const SCAN_BACKEND_INTERRUPTED_MESSAGE = "扫描后端已重启，任务已中断；请重试扫描";
const SCAN_SERVICE_CLOSED_MESSAGE = "扫描服务已关闭，任务已中断；请重试扫描";

const toIso = (value: Date | null): string | null => value?.toISOString() ?? null;
export class ScanQueueService {
  private readonly previews = new CandidatePreview();
  private readonly scheduler: TaskScheduler<ScanTask>;
  private readonly queuedTaskIds: string[] = [];
  private activeScan: { taskId: string; controller: AbortController } | null = null;
  private closing = false;
  private fault: string | null = null;
  private failedExecution: { taskId: string; error: unknown } | null = null;

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly taskEvents: TaskEventBus,
    private readonly config: ServerConfigService,
  ) {
    this.scheduler = new TaskScheduler({
      claimNext: async () => await this.claimNext(),
      runExecution: async (task) => await this.runTask(task),
      onExecutionError: async (task, error) => {
        this.failedExecution = { taskId: task.id, error };
        await this.failTask(task.id, error);
        this.failedExecution = null;
      },
      onDrainError: async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.fault = message;
        this.taskEvents.log({
          id: `scan-queue:${Date.now()}`,
          taskId: "scan-queue",
          type: "failed",
          message: `扫描队列停止排水：${message}`,
          createdAt: new Date().toISOString(),
          source: "task",
        });
      },
    });
  }

  async start(rootId: string): Promise<ScanTaskDto> {
    this.assertAdmittable();
    await this.mediaRoots.get(rootId);
    const state = await this.persistence.getState();
    const task = await state.repositories.scanTasks.create({ rootId });
    try {
      await this.addEvent(task.id, "queued", "扫描任务已排队");
      const queuedTask = await this.toDto(task.id);
      this.publishTask(queuedTask);
      return queuedTask;
    } finally {
      this.enqueue(task.id);
    }
  }

  async list(): Promise<ScanTaskListResponse> {
    const state = await this.persistence.getState();
    const tasks = await state.repositories.scanTasks.list();
    return { tasks: await Promise.all(tasks.map((task) => this.toDto(task.id))) };
  }

  async detail(taskId: string): Promise<ScanTaskDetailResponse> {
    return {
      task: await this.toDto(taskId),
      events: (await this.events(taskId)).events,
    };
  }

  async events(taskId: string): Promise<TaskEventListResponse> {
    const state = await this.persistence.getState();
    const events = await state.repositories.scanTasks.listEvents(taskId);
    return { events: events.map(toTaskEventDto) };
  }

  async logs(): Promise<LogListResponse> {
    const state = await this.persistence.getState();
    const tasks = await state.repositories.scanTasks.list();
    const events = await Promise.all(tasks.map((task) => state.repositories.scanTasks.listEvents(task.id)));
    const logs = events
      .flat()
      .map((event) => ({ ...toTaskEventDto(event), source: "task" as const }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { logs };
  }

  async retry(taskId: string): Promise<ScanTaskDto> {
    if (this.closing) throw new Error("Scan queue is closing");
    const state = await this.persistence.getState();
    let task = await state.repositories.scanTasks.get(taskId);
    if (this.fault) {
      const wasQueued = task.status === "queued";
      await this.recover();
      if (wasQueued) return await this.toDto(taskId);
      task = await state.repositories.scanTasks.get(taskId);
    }
    if (task.status === "running" || task.status === "queued") {
      throw new Error("Only completed or failed scan tasks can be retried");
    }
    await this.mediaRoots.get(task.rootId);
    const queued = await state.repositories.scanTasks.requeue(taskId);
    if (!queued) throw new Error(`Failed to requeue scan task: ${taskId}`);
    try {
      await this.addEvent(taskId, "queued", "重试扫描已排队");
      const queuedTask = await this.toDto(taskId);
      this.publishTask(queuedTask);
      return queuedTask;
    } finally {
      this.enqueue(taskId);
    }
  }

  async cancelCandidates(scanId: string): Promise<void> {
    await this.previews.cancel(scanId);
  }

  async candidates(input: ScanCandidatesInput): Promise<ScanCandidatesResponse> {
    return await this.previews.run(
      input.scanId ?? randomUUID(),
      async (signal) => await this.scanCandidates(input, signal),
    );
  }

  private async scanCandidates(input: ScanCandidatesInput, signal: AbortSignal): Promise<ScanCandidatesResponse> {
    if (this.closing) throw new Error("Scan queue is closing");
    const configuration = await this.config.get();
    const excludeDirPaths = input.excludeDirPaths?.map((path) => normalizeHostPath(path)) ?? [];
    const metadataPath = configuration.behavior.metadataOnly ? configuration.paths.metadataPath.trim() : "";
    if (metadataPath) excludeDirPaths.push(metadataPath);
    const admitted = await this.mediaRoots.admitDirectory({ hostPath: input.scanDir });
    const root = admitted.root;
    const hostPath = admitted.hostPath;
    const roots = await this.mediaRoots.listRoots();
    const supported = new Set(
      (input.supportedExtensions ?? []).map((extension) => `.${extension.replace(/^\./u, "").toLowerCase()}`),
    );
    const warnings = { count: 0, paths: [] as string[] };
    const generatedStrms = await registeredOutputPaths(
      (await this.persistence.getState()).repositories.library,
      (id) => this.mediaRoots.get(id),
      "strm",
    );
    const files = await listRootFiles(root, toRootRelativePath(root, hostPath), input.recursive, signal, {
      warnings,
      excludeDirectoryPaths: excludeDirPaths,
      excludeFileSymlinks: true,
      deduplicateDirectories: true,
      filterFile: createMediaFileFilter(configuration, generatedStrms, supported.size ? supported : undefined),
    });
    return {
      warnings,
      candidates: files.map((file) => {
        const resolved = resolveRootFile(roots, file.absolutePath);
        return {
          path: file.absolutePath,
          name: path.basename(file.relativePath),
          size: file.size,
          lastModified: file.modifiedAt?.toISOString() ?? null,
          extension: path.extname(file.relativePath).replace(/^\./u, "").toLowerCase(),
          ref: { rootId: resolved.root.id, relativePath: resolved.relativePath },
        };
      }),
    };
  }

  private async runTask(task: ScanTask): Promise<void> {
    const { id: taskId, rootId } = task;
    const controller = new AbortController();

    try {
      const state = await this.persistence.getState();
      this.activeScan = { taskId, controller };
      await this.addEvent(taskId, "running", "开始扫描媒体目录");
      this.publishTask(await this.toDto(taskId));
      const root = await this.mediaRoots.get(rootId);
      const result = await this.scanDirectory(root, controller.signal);
      controller.signal.throwIfAborted();
      const committed = await state.repositories.scanTasks.complete({
        taskId,
        rootId,
        results: result.videos,
        directoryCount: result.directoryCount,
      });
      if (!committed) return;
      await this.addEvent(
        taskId,
        "completed",
        `扫描完成：${result.videos.length} 个视频，${result.directoryCount} 个目录`,
      );
      this.publishTask(await this.toDto(taskId));
    } catch (error) {
      if (this.closing && controller.signal.aborted) throw new Error(SCAN_SERVICE_CLOSED_MESSAGE, { cause: error });
      throw error;
    } finally {
      if (this.activeScan?.taskId === taskId) this.activeScan = null;
    }
  }

  private async scanDirectory(root: MediaRoot, signal?: AbortSignal): Promise<ScanDirectoryResult> {
    const configuration = await this.config.get();
    const generatedStrms = await registeredOutputPaths(
      (await this.persistence.getState()).repositories.library,
      (id) => this.mediaRoots.get(id),
      "strm",
    );
    const metadataPath = configuration.behavior.metadataOnly ? configuration.paths.metadataPath.trim() : "";
    const files = await listRootFiles(root, "", true, signal, {
      excludeDirectoryPaths: metadataPath ? [metadataPath] : [],
      filterFile: (filePath) =>
        isPrimaryVideoFileName(path.basename(filePath)) && !generatedStrms.has(filesystemPathKey(filePath)),
    });
    const videos = files
      .filter((file) => isPrimaryVideoFileName(path.basename(file.relativePath)))
      .map((file) => ({
        relativePath: file.relativePath,
        size: file.size,
        modifiedAt: file.modifiedAt,
      }));
    const directoryCount = new Set(videos.map((video) => path.posix.dirname(video.relativePath))).size;

    videos.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
    return { videos, directoryCount };
  }

  private async toDto(taskId: string): Promise<ScanTaskDto> {
    const state = await this.persistence.getState();
    const task = await state.repositories.scanTasks.get(taskId);
    const root = await state.repositories.mediaRoots.get(task.rootId).catch(() => null);
    const videos = await state.repositories.scanTasks.listScanResults(taskId);
    return {
      id: task.id,
      kind: "scan",
      rootId: task.rootId,
      rootDisplayName: root?.displayName ?? "未知媒体目录",
      status: task.status,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      startedAt: toIso(task.startedAt),
      completedAt: toIso(task.completedAt),
      videoCount: task.videoCount,
      directoryCount: task.directoryCount,
      error: task.error,
      videos: videos.map((result) => result.relativePath),
    };
  }

  private async addEvent(taskId: string, type: string, message: string): Promise<TaskEventDto> {
    const state = await this.persistence.getState();
    const event = await state.repositories.scanTasks.addEvent({ taskId, type, message });
    const dto = toTaskEventDto(event);
    this.taskEvents.log(decorateTaskLog(dto));
    return dto;
  }

  private publishTask(task: ScanTaskDto): void {
    this.taskEvents.lifecycle(task);
    this.taskEvents.invalidate("scan");
  }

  private enqueue(taskId: string): void {
    this.queuedTaskIds.push(taskId);
    this.scheduler.drain();
  }

  private assertAdmittable(): void {
    if (this.closing) throw new Error("Scan queue is closing");
    if (this.fault) throw new Error(`Scan queue requires repair: ${this.fault}`);
  }

  private async claimNext(): Promise<ScanTask | null> {
    const state = await this.persistence.getState();
    while (true) {
      const taskId = this.queuedTaskIds[0];
      if (!taskId) return null;
      const task = await state.repositories.scanTasks.claim(taskId);
      this.queuedTaskIds.shift();
      if (task) return task;
    }
  }

  private async failTask(taskId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const state = await this.persistence.getState();
    const committed = await state.repositories.scanTasks.fail(taskId, message);
    if (!committed) return;
    await this.addEvent(taskId, "failed", message);
    this.publishTask(await this.toDto(taskId));
  }

  async recoverInterrupted(): Promise<void> {
    await this.interruptUnfinished(SCAN_BACKEND_INTERRUPTED_MESSAGE);
  }

  async recover(): Promise<void> {
    if (this.closing) throw new Error("Scan queue is closing");
    await this.scheduler.waitForIdle();
    if (this.failedExecution) {
      await this.failTask(this.failedExecution.taskId, this.failedExecution.error);
      this.failedExecution = null;
    }
    this.fault = null;
    this.scheduler.allowDrain();
    if (this.queuedTaskIds.length > 0) this.scheduler.drain();
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.queuedTaskIds.length = 0;
    this.scheduler.requestStop();
    this.activeScan?.controller.abort();
    await this.scheduler.waitForIdle();
    await this.interruptUnfinished(SCAN_SERVICE_CLOSED_MESSAGE);
  }

  private async interruptUnfinished(message: string): Promise<void> {
    const state = await this.persistence.getState();
    const interrupted = await state.repositories.scanTasks.interruptUnfinished(message);
    for (const task of interrupted) {
      await this.addEvent(task.id, "failed", message);
      this.publishTask(await this.toDto(task.id));
    }
  }
}
