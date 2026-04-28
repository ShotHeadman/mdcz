import path from "node:path";
import type { ScanTaskDto, ScanTaskListResponse, TaskEventDto, TaskEventListResponse } from "@mdcz/shared/serverDtos";
import { isVideoFileName } from "@mdcz/shared/videoClassification";
import { listRootFiles, type MediaRoot } from "@mdcz/storage";
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
    await this.addEvent(task.id, "queued", "Scan queued");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(task.id) });
    void this.drain();
    return await this.toDto(task.id);
  }

  async list(): Promise<ScanTaskListResponse> {
    const state = await this.persistence.getState();
    const tasks = await state.repositories.tasks.list("scan");
    return { tasks: await Promise.all(tasks.map((task) => this.toDto(task.id))) };
  }

  async events(taskId: string): Promise<TaskEventListResponse> {
    const state = await this.persistence.getState();
    const events = await state.repositories.tasks.listEvents(taskId);
    return { events: events.map(toTaskEventDto) };
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
    await this.addEvent(taskId, "running", "Scan started");
    this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });

    try {
      const root = await this.mediaRoots.getActiveRoot(rootId);
      const result = await this.scanDirectory(root);
      await state.repositories.tasks.replaceScanResults({ taskId, rootId, results: result.videos });
      await state.repositories.tasks.patch(taskId, {
        status: "completed",
        finishedAt: new Date(),
        videoCount: result.videos.length,
        directoryCount: result.directoryCount,
        error: null,
      });
      await this.addEvent(
        taskId,
        "completed",
        `Scan completed: ${result.videos.length} videos in ${result.directoryCount} directories`,
      );
      this.taskEvents.publish({ kind: "task", task: await this.toDto(taskId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await state.repositories.tasks.patch(taskId, {
        status: "failed",
        finishedAt: new Date(),
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
    const videos = await state.repositories.tasks.listScanResults(taskId);
    return {
      id: task.id,
      rootId: task.rootId,
      status: task.status,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      startedAt: toIso(task.startedAt),
      finishedAt: toIso(task.finishedAt),
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
