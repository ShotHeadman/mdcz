import type { LogEntryDto, TaskNotificationDto, TaskStatus } from "@mdcz/shared/serverDtos";

export interface TaskLifecycleEvent {
  id: string;
  kind: "scan" | "scrape" | "maintenance";
  rootId: string;
  rootDisplayName: string;
  status: TaskStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export type TaskResource = Extract<TaskNotificationDto, { kind: "invalidate" }>["resources"][number];

export class TaskEventBus {
  readonly #listeners = new Set<(notification: TaskNotificationDto) => void>();
  readonly #lifecycleListeners = new Set<(task: TaskLifecycleEvent) => void>();

  subscribe(listener: (notification: TaskNotificationDto) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeLifecycle(listener: (task: TaskLifecycleEvent) => void): () => void {
    this.#lifecycleListeners.add(listener);
    return () => this.#lifecycleListeners.delete(listener);
  }

  lifecycle(task: TaskLifecycleEvent): void {
    for (const listener of this.#lifecycleListeners) listener(task);
  }

  invalidate(...resources: TaskResource[]): void {
    this.emit({ kind: "invalidate", resources: [...new Set(resources)] });
  }

  log(log: LogEntryDto): void {
    this.emit({ kind: "log", log });
  }

  private emit(notification: TaskNotificationDto): void {
    for (const listener of this.#listeners) listener(notification);
  }

  listenerCount(): number {
    return this.#listeners.size;
  }
}

export const createTaskEventBus = (): TaskEventBus => new TaskEventBus();
export const formatSseEvent = (notification: TaskNotificationDto): string =>
  `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
