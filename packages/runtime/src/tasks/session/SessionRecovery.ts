import type { ScraperStatus } from "@mdcz/shared/types";
import { createIdleScraperStatus, type PersistedSessionState, type RecoverableSessionSnapshot } from "./types";

const toNonNegativeInteger = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

const isSessionState = (value: unknown): value is ScraperStatus["state"] =>
  value === "idle" || value === "running" || value === "stopping" || value === "paused";

const normalizePersistedStatus = (status: Partial<ScraperStatus>): ScraperStatus => {
  const idleStatus = createIdleScraperStatus();
  const running = typeof status.running === "boolean" ? status.running : idleStatus.running;
  const state =
    status.state === "running" || status.state === "stopping" || status.state === "paused"
      ? status.state
      : running
        ? "running"
        : "idle";

  return {
    state: isSessionState(state) ? state : idleStatus.state,
    running,
    totalFiles: toNonNegativeInteger(status.totalFiles),
    completedFiles: toNonNegativeInteger(status.completedFiles),
    successCount: toNonNegativeInteger(status.successCount),
    failedCount: toNonNegativeInteger(status.failedCount),
    skippedCount: toNonNegativeInteger(status.skippedCount),
  };
};

const collectStrings = (values: unknown[]): string[] =>
  values.filter((value): value is string => typeof value === "string");

export const parsePersistedSessionState = (value: unknown): PersistedSessionState | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Partial<PersistedSessionState>;
  if (
    typeof parsed.taskId !== "string" ||
    !parsed.status ||
    typeof parsed.status !== "object" ||
    !Array.isArray(parsed.failedFiles) ||
    !Array.isArray(parsed.pendingFiles)
  ) {
    return null;
  }

  return {
    taskId: parsed.taskId,
    status: normalizePersistedStatus(parsed.status as Partial<ScraperStatus>),
    failedFiles: collectStrings(parsed.failedFiles),
    pendingFiles: collectStrings(parsed.pendingFiles),
  };
};

export const hasRecoverableWork = (snapshot: PersistedSessionState | null): snapshot is RecoverableSessionSnapshot =>
  Boolean(snapshot?.status.running && (snapshot.pendingFiles.length > 0 || snapshot.failedFiles.length > 0));

export const toRecoverableSnapshot = (snapshot: PersistedSessionState | null): RecoverableSessionSnapshot | null =>
  hasRecoverableWork(snapshot) ? snapshot : null;

export interface RecoverableSessionSummary {
  recoverable: boolean;
  pendingCount: number;
  failedCount: number;
}

export const summarizeRecoverableSession = (input: {
  pendingCount?: number;
  failedCount?: number;
}): RecoverableSessionSummary => {
  const pendingCount = toNonNegativeInteger(input.pendingCount);
  const failedCount = toNonNegativeInteger(input.failedCount);
  return {
    recoverable: pendingCount > 0 || failedCount > 0,
    pendingCount,
    failedCount,
  };
};

export type RecoverableSessionAction = "recover" | "discard";

export interface RecoverableSessionResolveResult<TTask> {
  success: true;
  message: string;
  task: TTask | null;
}

export interface RecoverableSessionPort<TSummary extends RecoverableSessionSummary, TTask> {
  summarize(): Promise<TSummary>;
  recover(): Promise<TTask>;
  discard(): Promise<void>;
}

export const resolveRecoverableSession = async <TSummary extends RecoverableSessionSummary, TTask>(
  port: RecoverableSessionPort<TSummary, TTask>,
  input: {
    action?: RecoverableSessionAction;
    recoverMessage?: string;
    discardMessage?: string;
  } = {},
): Promise<RecoverableSessionResolveResult<TTask>> => {
  const action = input.action ?? "recover";
  if (action === "discard") {
    await port.discard();
    return {
      success: true,
      message: input.discardMessage ?? "Recoverable session discarded",
      task: null,
    };
  }

  return {
    success: true,
    message: input.recoverMessage ?? "Recoverable session recovered",
    task: await port.recover(),
  };
};
