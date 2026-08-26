import type { CrawlerData, DownloadedAssets, ScrapeResult, ScraperStatus } from "@mdcz/shared/types";
import type { RuntimeLogger } from "../../shared";

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

export interface ScrapeSuccessItem {
  sourcePath: string;
  number: string;
  title: string | null;
  actors: string[];
  crawlerData?: CrawlerData;
  assets?: DownloadedAssets;
  lastKnownPath: string | null;
  nfoPath?: string | null;
  outputPath?: string | null;
  posterPath: string | null;
}

export interface RecoverableSessionSnapshot {
  taskId: string;
  status: ScraperStatus;
  failedFiles: string[];
  pendingFiles: string[];
}

export interface ScrapeSessionOptions {
  logger?: RuntimeLogger;
  executionStore?: ScrapeSessionExecutionStore;
}

export interface SessionExecution {
  taskId: string;
  executionVersion: number;
}

export interface ScrapeSessionExecutionStore {
  create(files: readonly string[]): Promise<SessionExecution>;
  recover(taskId: string): Promise<SessionExecution>;
  getRecoverable(): Promise<RecoverableSessionSnapshot | null>;
  discard(taskId: string): Promise<void>;
  markProcessing(execution: SessionExecution, sourcePath: string): Promise<boolean>;
  markResult(execution: SessionExecution, sourcePath: string, result: ScrapeResult | null): Promise<boolean>;
  queueRetry(execution: SessionExecution, sourcePath: string): Promise<boolean>;
  pause(execution: SessionExecution): Promise<boolean>;
  resume(execution: SessionExecution): Promise<SessionExecution | null>;
  stop(execution: SessionExecution): Promise<boolean>;
  complete(execution: SessionExecution, status: ScraperStatus): Promise<boolean>;
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
