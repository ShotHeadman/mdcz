import type { LogEntryDto, TaskNotificationDto } from "@mdcz/shared/serverDtos";

export interface TaskLifecycleEvent {
  id: string;
  kind: "scan" | "scrape" | "maintenance";
  rootId: string;
  rootDisplayName: string;
  status: "queued" | "running" | "paused" | "stopping" | "completed" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export type TaskResource = Extract<TaskNotificationDto, { kind: "invalidate" }>["resources"][number];
export type TaskEventEnvelope = { id: string; event: "notification"; data: TaskNotificationDto };

export class TaskEventBus {
  readonly #listeners = new Set<(event: TaskEventEnvelope) => void>();
  readonly #lifecycleListeners = new Set<(task: TaskLifecycleEvent) => void>();
  #nextEventId = 1;

  subscribe(listener: (event: TaskEventEnvelope) => void): () => void {
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

  invalidate(...resources: TaskResource[]): TaskEventEnvelope {
    return this.emit({ kind: "invalidate", resources: [...new Set(resources)] });
  }

  log(log: LogEntryDto): void {
    this.emit({ kind: "log", log });
  }

  private emit(data: TaskNotificationDto): TaskEventEnvelope {
    const event = { id: String(this.#nextEventId++), event: "notification" as const, data };
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  listenerCount(): number {
    return this.#listeners.size;
  }
}

export const createTaskEventBus = (): TaskEventBus => new TaskEventBus();
export const formatSseEvent = (event: TaskEventEnvelope): string =>
  `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
