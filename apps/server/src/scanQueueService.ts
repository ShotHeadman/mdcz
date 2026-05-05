import { lstat } from "node:fs/promises";
import path from "node:path";
import { filterMediaCandidates, isHostPathWithinDirectory } from "@mdcz/shared/mediaCandidate";
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
import { isVideoFileName } from "@mdcz/shared/videoClassification";
import { listRootFiles, type MediaRoot, normalizeHostPath } from "@mdcz/storage";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import type { TaskEventBus } from "./taskEvents";

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
  #running = false;

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly taskEvents: TaskEventBus,
  ) {}

  async start(rootId: string): Promise<ScanTaskDto> {
    await this.mediaRoots.getActiveRoot(rootId);
    const state = await this.persistence.getState();
    const task = await state.repositories.tasks.createScanTask({ rootId });
    await this.addEvent(task.id, "queued", "扫描任务已排队");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(task.id) });
    void this.drain();
    return await this.toDto(task.id);
  }

  async list(): Promise<ScanTaskListResponse> {
    const state = await this.persistence.getState();
    const tasks = await state.repositories.tasks.list("scan");
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
    const tasks = (await this.list()).tasks;
    const events = await Promise.all(tasks.map((task) => this.events(task.id)));
    const logs = events
      .flatMap((eventList) => eventList.events)
      .map((event) => ({ ...event, source: "task" as const }))
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
    await state.repositories.tasks.patch(taskId, {
      status: "queued",
      startedAt: null,
      completedAt: null,
      videoCount: 0,
      directoryCount: 0,
      error: null,
    });
    await state.repositories.tasks.replaceScanResults({ taskId, rootId: task.rootId, results: [] });
    await this.addEvent(taskId, "queued", "重试扫描已排队");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    void this.drain();
    return await this.toDto(taskId);
  }

  async candidates(input: ScanCandidatesInput): Promise<ScanCandidatesResponse> {
    const hostPath = normalizeHostPath(input.scanDir);
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
          return supported.size > 0 ? supported.has(extension) : isVideoFileName(path.basename(file.relativePath));
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
      candidates: filterMediaCandidates(
        candidates.filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)),
        input.excludeDirs ?? [],
      ).filter((candidate) =>
        (input.excludeDirs ?? []).every((excludeDir) => !isHostPathWithinDirectory(candidate.path, excludeDir)),
      ),
    };
  }

  async resumeQueued(): Promise<void> {
    const state = await this.persistence.getState();
    await state.repositories.tasks.requeueRunning("scan");
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    try {
      while (true) {
        const state = await this.persistence.getState();
        const task = await state.repositories.tasks.nextQueued("scan");
        if (!task) {
          return;
        }
        await this.runTask(task.id, task.rootId);
      }
    } finally {
      this.#running = false;
    }
  }

  private async runTask(taskId: string, rootId: string): Promise<void> {
    const state = await this.persistence.getState();
    await state.repositories.tasks.patch(taskId, {
      status: "running",
      startedAt: new Date(),
      error: null,
    });
    await this.addEvent(taskId, "running", "开始扫描媒体目录");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });

    try {
      const root = await this.mediaRoots.getActiveRoot(rootId);
      const result = await this.scanDirectory(root);
      await state.repositories.tasks.replaceScanResults({ taskId, rootId, results: result.videos });
      await state.repositories.tasks.patch(taskId, {
        status: "completed",
        completedAt: new Date(),
        videoCount: result.videos.length,
        directoryCount: result.directoryCount,
        error: null,
      });
      await this.addEvent(
        taskId,
        "completed",
        `扫描完成：${result.videos.length} 个视频，${result.directoryCount} 个目录`,
      );
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await state.repositories.tasks.patch(taskId, {
        status: "failed",
        completedAt: new Date(),
        error: message,
      });
      await this.addEvent(taskId, "failed", message);
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    }
  }

  private async scanDirectory(root: MediaRoot): Promise<ScanDirectoryResult> {
    const files = await listRootFiles(root, "", true);
    const videos = files
      .filter((file) => isVideoFileName(path.basename(file.relativePath)))
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
      kind: task.kind,
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
