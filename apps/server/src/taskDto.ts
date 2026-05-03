import type { ScanTaskDto, TaskEventDto } from "@mdcz/shared/serverDtos";

export const toIso = (value: Date | null): string | null => value?.toISOString() ?? null;

export interface TaskEventRecord {
  id: string;
  taskId: string;
  type: string;
  message: string;
  createdAt: Date;
}

export const toTaskEventDto = (event: TaskEventRecord): TaskEventDto => ({
  id: event.id,
  taskId: event.taskId,
  type: event.type,
  message: event.message,
  createdAt: event.createdAt.toISOString(),
});

export interface TaskDtoRecord {
  id: string;
  kind: ScanTaskDto["kind"];
  rootId: string;
  status: ScanTaskDto["status"];
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  videoCount: number;
  directoryCount: number;
  error: string | null;
}

export const toScanTaskDto = (
  task: TaskDtoRecord,
  options: {
    rootDisplayName: string;
    videoCount?: number;
    videos: string[];
  },
): ScanTaskDto => ({
  id: task.id,
  kind: task.kind,
  rootId: task.rootId,
  rootDisplayName: options.rootDisplayName,
  status: task.status,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
  startedAt: toIso(task.startedAt),
  completedAt: toIso(task.completedAt),
  videoCount: options.videoCount ?? task.videoCount,
  directoryCount: task.directoryCount,
  error: task.error,
  videos: options.videos,
});
