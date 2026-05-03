export type RuntimeTaskStatus = "queued" | "running" | "paused" | "stopping" | "completed" | "failed" | "canceled";

export type RuntimeTaskAction = "start" | "pause" | "resume" | "stop" | "complete" | "fail" | "cancel" | "retry";

export interface RuntimeTaskSnapshot {
  id: string;
  status: RuntimeTaskStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export interface RuntimeTaskTransition {
  action: RuntimeTaskAction;
  now?: Date;
  error?: string | null;
}

const terminalStatuses = new Set<RuntimeTaskStatus>(["completed", "failed", "canceled"]);

const assertTransition = (from: RuntimeTaskStatus, action: RuntimeTaskAction): void => {
  const allowed: Partial<Record<RuntimeTaskAction, RuntimeTaskStatus[]>> = {
    start: ["queued"],
    pause: ["queued", "running"],
    resume: ["paused"],
    stop: ["queued", "running", "paused", "stopping"],
    complete: ["running", "stopping"],
    fail: ["queued", "running", "paused", "stopping"],
    cancel: ["queued", "paused"],
    retry: ["completed", "failed", "canceled", "paused"],
  };

  if (!allowed[action]?.includes(from)) {
    throw new Error(`Invalid task transition: ${from} -> ${action}`);
  }
};

export const transitionTask = (
  snapshot: RuntimeTaskSnapshot,
  transition: RuntimeTaskTransition,
): RuntimeTaskSnapshot => {
  assertTransition(snapshot.status, transition.action);
  const now = transition.now ?? new Date();

  switch (transition.action) {
    case "start":
      return { ...snapshot, status: "running", startedAt: snapshot.startedAt ?? now, completedAt: null, error: null };
    case "pause":
      return { ...snapshot, status: "paused", error: null };
    case "resume":
      return { ...snapshot, status: "queued", startedAt: null, completedAt: null, error: null };
    case "stop":
      return snapshot.status === "running"
        ? { ...snapshot, status: "stopping", error: transition.error ?? snapshot.error }
        : { ...snapshot, status: "failed", completedAt: now, error: transition.error ?? "Task stopped" };
    case "complete":
      return { ...snapshot, status: "completed", completedAt: now, error: null };
    case "fail":
      return { ...snapshot, status: "failed", completedAt: now, error: transition.error ?? snapshot.error };
    case "cancel":
      return { ...snapshot, status: "canceled", completedAt: now, error: transition.error ?? "Task canceled" };
    case "retry":
      return { ...snapshot, status: "queued", startedAt: null, completedAt: null, error: null };
  }
};

export const isTerminalTaskStatus = (status: RuntimeTaskStatus): boolean => terminalStatuses.has(status);

export * from "./session/ScrapeSession";
export * from "./session/SessionProgressTracker";
export * from "./session/SessionRecovery";
export * from "./session/SessionStateStore";
export * from "./session/types";
