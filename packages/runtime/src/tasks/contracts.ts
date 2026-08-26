export type ExecutionStatus = "queued" | "running" | "paused" | "stopping" | "completed" | "failed";

export type ExecutionItemStatus = "pending" | "processing" | "success" | "failed" | "skipped";

export interface ClaimedExecution {
  id: string;
  executionVersion: number;
}

export interface ExecutionStore<TExecution extends ClaimedExecution, TItem> {
  claimNext(kind: string): Promise<TExecution | null>;
  read(executionId: string): Promise<TExecution>;
  readPendingItems(executionId: string): Promise<TItem[]>;
  requeueRunning(kind: string): Promise<void>;
}

export interface EventSink<TEvent> {
  publish(event: TEvent): void | Promise<void>;
}

export interface ProgressSink<TProgress> {
  publish(progress: TProgress): void | Promise<void>;
}

export const noopEventSink: EventSink<unknown> = { publish: () => undefined };
export const noopProgressSink: ProgressSink<unknown> = { publish: () => undefined };
