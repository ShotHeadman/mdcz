import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  listRootFiles,
  type MediaRoot,
  normalizeHostPath,
  resolveRootFile,
  toRootRelativePath,
} from "@mdcz/media-store";
import type { ScanTask } from "@mdcz/persistence";
import { TaskScheduler } from "@mdcz/runtime/tasks";
import { isHostPathWithinDirectory } from "@mdcz/shared/mediaCandidate";
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
  private readonly scheduler: TaskScheduler<ScanTask>;
  private readonly queuedTaskIds: string[] = [];
  private activeScan: { taskId: string; controller: AbortController } | null = null;
  private closing = false;

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly taskEvents: TaskEventBus,
  ) {
    this.scheduler = new TaskScheduler({
      claimNext: async () => await this.claimNext(),
      runExecution: async (task) => await this.runTask(task),
    });
  }

  async start(rootId: string): Promise<ScanTaskDto> {
    if (this.closing) throw new Error("Scan queue is closing");
    await this.mediaRoots.get(rootId);
    const state = await this.persistence.getState();
    const task = await state.repositories.scanTasks.create({ rootId });
    await this.addEvent(task.id, "queued", "扫描任务已排队");
    const queuedTask = await this.toDto(task.id);
    this.publishTask(queuedTask);
    this.enqueue(task.id);
    return queuedTask;
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
    const task = await state.repositories.scanTasks.get(taskId);
    if (task.status === "running" || task.status === "queued") {
      throw new Error("Only completed or failed scan tasks can be retried");
    }
    await this.mediaRoots.get(task.rootId);
    const queued = await state.repositories.scanTasks.requeue(taskId);
    if (!queued) throw new Error(`Failed to requeue scan task: ${taskId}`);
    await this.addEvent(taskId, "queued", "重试扫描已排队");
    const queuedTask = await this.toDto(taskId);
    this.publishTask(queuedTask);
    this.enqueue(taskId);
    return queuedTask;
  }

  async candidates(input: ScanCandidatesInput): Promise<ScanCandidatesResponse> {
    if (this.closing) throw new Error("Scan queue is closing");
    const hostPath = normalizeHostPath(input.scanDir);
    const excludeDirPaths = input.excludeDirPaths?.map((path) => normalizeHostPath(path)) ?? [];
    const roots = await this.mediaRoots.listRoots();
    const root = resolveRootFile(roots, hostPath).root;
    const supported = new Set(
      (input.supportedExtensions ?? []).map((extension) => extension.replace(/^\./u, "").toLowerCase()),
    );
    const files = await listRootFiles(root, toRootRelativePath(root, hostPath), true);
    const candidates = await Promise.all(
      files
        .filter((file) => {
          const extension = path.extname(file.relativePath).replace(/^\./u, "").toLowerCase();
          if (excludeDirPaths.some((directoryPath) => isHostPathWithinDirectory(file.absolutePath, directoryPath))) {
            return false;
          }
          return supported.size > 0
            ? supported.has(extension) && isPrimaryVideoFileName(path.basename(file.relativePath))
            : isPrimaryVideoFileName(path.basename(file.relativePath));
        })
        .map(async (file) => {
          const stats = await lstat(file.absolutePath).catch(() => null);
          if (stats?.isSymbolicLink()) {
            return null;
          }
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
    );
    return {
      candidates: candidates.filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)),
    };
  }

  private async runTask(task: ScanTask): Promise<void> {
    const state = await this.persistence.getState();
    const { id: taskId, rootId } = task;
    const controller = new AbortController();
    this.activeScan = { taskId, controller };
    await this.addEvent(taskId, "running", "开始扫描媒体目录");
    this.publishTask(await this.toDto(taskId));

    try {
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
      const message =
        this.closing && controller.signal.aborted
          ? SCAN_SERVICE_CLOSED_MESSAGE
          : error instanceof Error
            ? error.message
            : String(error);
      const committed = await state.repositories.scanTasks.fail(taskId, message);
      if (!committed) return;
      await this.addEvent(taskId, "failed", message);
      this.publishTask(await this.toDto(taskId));
    } finally {
      if (this.activeScan?.taskId === taskId) this.activeScan = null;
    }
  }

  private async scanDirectory(root: MediaRoot, signal?: AbortSignal): Promise<ScanDirectoryResult> {
    const files = await listRootFiles(root, "", true, signal);
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

  private async claimNext(): Promise<ScanTask | null> {
    const state = await this.persistence.getState();
    while (true) {
      const taskId = this.queuedTaskIds.shift();
      if (!taskId) return null;
      const task = await state.repositories.scanTasks.claim(taskId);
      if (task) return task;
    }
  }

  async recoverInterrupted(): Promise<void> {
    await this.interruptUnfinished(SCAN_BACKEND_INTERRUPTED_MESSAGE);
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
