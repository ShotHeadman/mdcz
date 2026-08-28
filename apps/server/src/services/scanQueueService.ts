import { lstat } from "node:fs/promises";
import path from "node:path";
import { listRootFiles, type MediaRoot, normalizeHostPath } from "@mdcz/media-store";
import type { TaskRecord } from "@mdcz/persistence";
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

const toIso = (value: Date | null): string | null => value?.toISOString() ?? null;
const toPosixPath = (value: string): string => value.replace(/\\/gu, "/");

export class ScanQueueService {
  private readonly scheduler: TaskScheduler<TaskRecord>;
  private readonly queuedTaskIds: string[] = [];

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
    await this.mediaRoots.getActiveRoot(rootId);
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.createScanTask({ rootId });
    await this.addEvent(task.id, "queued", "扫描任务已排队");
    const queuedTask = await this.toDto(task.id);
    this.publishTask(queuedTask);
    this.enqueue(task.id);
    return queuedTask;
  }

  async list(): Promise<ScanTaskListResponse> {
    const state = await this.persistence.getState();
    const tasks = await state.repositories.tasks.list();
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
    const events = await state.repositories.tasks.listEvents(taskId);
    return { events: events.map(toTaskEventDto) };
  }

  async logs(): Promise<LogListResponse> {
    const state = await this.persistence.getState();
    const tasks = await state.repositories.tasks.list();
    const events = await Promise.all(tasks.map((task) => state.repositories.tasks.listEvents(task.id)));
    const logs = events
      .flat()
      .map((event) => ({ ...toTaskEventDto(event), source: "task" as const }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { logs };
  }

  async retry(taskId: string): Promise<ScanTaskDto> {
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.get(taskId);
    if (task.status === "running" || task.status === "queued") {
      throw new Error("Only completed or failed scan tasks can be retried");
    }
    await this.mediaRoots.getActiveRoot(task.rootId);
    const queued = await state.repositories.tasks.patch(
      taskId,
      {
        status: "queued",
        startedAt: null,
        completedAt: null,
        error: null,
        videoCount: 0,
        directoryCount: 0,
      },
      { status: ["completed", "failed"] },
    );
    if (!queued) throw new Error(`Failed to requeue scan task: ${taskId}`);
    await state.repositories.tasks.replaceScanResults({ taskId, rootId: task.rootId, results: [] });
    await this.addEvent(taskId, "queued", "重试扫描已排队");
    const queuedTask = await this.toDto(taskId);
    this.publishTask(queuedTask);
    this.enqueue(taskId);
    return queuedTask;
  }

  async candidates(input: ScanCandidatesInput): Promise<ScanCandidatesResponse> {
    const hostPath = normalizeHostPath(input.scanDir);
    const excludeDirPaths = input.excludeDirPaths?.map((path) => normalizeHostPath(path)) ?? [];
    const registeredRoots = (await this.mediaRoots.list()).roots.filter((root) => root.enabled);
    const root: MediaRoot = {
      id: "adhoc-scan",
      displayName: path.basename(hostPath) || hostPath,
      hostPath,
      rootType: "mounted-filesystem",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const supported = new Set(
      (input.supportedExtensions ?? []).map((extension) => extension.replace(/^\./u, "").toLowerCase()),
    );
    const files = await listRootFiles(root, "", true);
    const candidates = await Promise.all(
      files
        .filter((file) => {
          const extension = path.extname(file.relativePath).replace(/^\./u, "").toLowerCase();
          const absolutePath = path.resolve(hostPath, file.relativePath);
          if (excludeDirPaths.some((directoryPath) => isHostPathWithinDirectory(absolutePath, directoryPath))) {
            return false;
          }
          return supported.size > 0
            ? supported.has(extension) && isPrimaryVideoFileName(path.basename(file.relativePath))
            : isPrimaryVideoFileName(path.basename(file.relativePath));
        })
        .map(async (file) => {
          const absolutePath = path.resolve(hostPath, file.relativePath);
          const stats = await lstat(absolutePath).catch(() => null);
          if (stats?.isSymbolicLink()) {
            return null;
          }
          const registeredRoot = registeredRoots.find((candidate) =>
            isHostPathWithinDirectory(absolutePath, candidate.hostPath),
          );
          const rootRelativePath = registeredRoot
            ? toPosixPath(path.relative(registeredRoot.hostPath, absolutePath))
            : undefined;
          return {
            path: absolutePath,
            name: path.basename(file.relativePath),
            size: file.size,
            lastModified: file.modifiedAt?.toISOString() ?? null,
            extension: path.extname(file.relativePath).replace(/^\./u, "").toLowerCase(),
            relativePath: file.relativePath,
            relativeDirectory:
              path.posix.dirname(file.relativePath) === "." ? "" : path.posix.dirname(file.relativePath),
            rootId: registeredRoot?.id,
            rootRelativePath,
          };
        }),
    );
    return {
      candidates: candidates.filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)),
    };
  }

  private async runTask(task: TaskRecord): Promise<void> {
    const state = await this.persistence.getState();
    const { id: taskId, rootId } = task;
    await this.addEvent(taskId, "running", "开始扫描媒体目录");
    this.publishTask(await this.toDto(taskId));

    try {
      const root = await this.mediaRoots.getActiveRoot(rootId);
      const result = await this.scanDirectory(root);
      const committed = await state.repositories.tasks.completeScanTask({
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
      const message = error instanceof Error ? error.message : String(error);
      const committed = await state.repositories.tasks.patch(
        taskId,
        { status: "failed", completedAt: new Date(), error: message },
        { status: "running" },
      );
      if (!committed) return;
      await this.addEvent(taskId, "failed", message);
      this.publishTask(await this.toDto(taskId));
    }
  }

  private async scanDirectory(root: MediaRoot): Promise<ScanDirectoryResult> {
    const files = await listRootFiles(root, "", true);
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
    const task = await state.repositories.tasks.get(taskId);
    const root = await state.repositories.mediaRoots.get(task.rootId, { includeDeleted: true }).catch(() => null);
    const videos = await state.repositories.tasks.listScanResults(taskId);
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
    const event = await state.repositories.tasks.addEvent({ taskId, type, message });
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

  private async claimNext(): Promise<TaskRecord | null> {
    const state = await this.persistence.getState();
    while (true) {
      const taskId = this.queuedTaskIds.shift();
      if (!taskId) return null;
      const task = await state.repositories.tasks.claim(taskId);
      if (task) return task;
    }
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
