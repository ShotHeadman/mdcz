import type { ScrapeResult, ScraperStatus } from "@shared/types";

export type SessionState = ScraperStatus["state"];

export enum SessionFileState {
  Pending = "pending",
  Failed = "failed",
  RetryPending = "retry_pending",
}

export interface QueueTask {
  sourcePath: string;
  isRetry: boolean;
  taskFn: (signal: AbortSignal) => Promise<ScrapeResult>;
}

export interface PersistedSessionState {
  taskId: string;
  status: ScraperStatus;
  failedFiles: string[];
  pendingFiles: string[];
}

export type RecoverableSessionSnapshot = PersistedSessionState;

export interface ScrapeSessionOptions {
  persistIntervalMs?: number;
  statePath?: string;
}

export const createIdleScraperStatus = (): ScraperStatus => ({
  state: "idle",
  running: false,
  totalFiles: 0,
  completedFiles: 0,
  successCount: 0,
  failedCount: 0,
  skippedCount: 0,
});
