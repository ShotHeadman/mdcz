import { useEffect } from "react";
import type { BriefPort } from "./BriefPort";
import { type BriefCell, type BriefCellState, type BriefOutcome, useBriefStore } from "./briefStore";

const POLL_INTERVAL_MS = 2_000;
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["queued", "discovering", "running", "paused", "stopping"]);

const endState = (status: string): BriefCellState =>
  ACTIVE_STATUSES.has(status)
    ? "running"
    : status === "completed"
      ? "done"
      : status === "failed"
        ? "failed"
        : "stopped";

const readJob = async (
  cell: BriefCell,
  port: BriefPort,
): Promise<{ state: BriefCellState; outcome: BriefOutcome; error?: string } | null> => {
  const job = cell.job;
  if (!job || job.kind === "instant" || job.kind === "request") return null;
  if (job.kind === "scrape") {
    const snapshots = await Promise.all(job.taskIds.map((taskId) => port.scrapeSnapshot(taskId)));
    if (snapshots.some((snapshot) => !snapshot)) return { state: "stopped", outcome: { kind: "lost" } };
    const tasks = snapshots.flatMap((snapshot) => (snapshot ? [snapshot] : []));
    const statuses = tasks.map((snapshot) => snapshot.task.status);
    const totals = tasks.map((snapshot) => snapshot.progress.totalItems);
    return {
      state: statuses.some((status) => ACTIVE_STATUSES.has(status))
        ? "running"
        : statuses.every((status) => status === "completed")
          ? "done"
          : statuses.includes("failed")
            ? "failed"
            : "stopped",
      outcome: {
        kind: "scrape",
        paused: statuses.every((status) => status === "paused"),
        success: tasks.reduce((sum, snapshot) => sum + snapshot.task.successCount, 0),
        failed: tasks.reduce((sum, snapshot) => sum + snapshot.task.failedCount, 0),
        skipped: tasks.reduce((sum, snapshot) => sum + snapshot.task.skippedCount, 0),
        completed: tasks.reduce((sum, snapshot) => sum + snapshot.progress.completedItems, 0),
        total: totals.every((total) => total !== null)
          ? totals.reduce<number>((sum, total) => sum + (total ?? 0), 0)
          : null,
      },
      error: tasks.find((snapshot) => snapshot.task.error)?.task.error ?? undefined,
    };
  }
  if (job.kind === "maintenance") {
    const session = await port.maintenanceSession();
    if (session?.id !== job.sessionId) return { state: "stopped", outcome: { kind: "lost" } };
    const state = endState(session.status);
    return {
      // Analysis only prepares the changes; applying them stays on the workbench's review screen.
      state: session.phase === "preview" && state === "done" ? "review" : state,
      outcome: {
        kind: "maintenance",
        paused: session.status === "paused",
        phase: session.phase,
        changes: session.previews.filter((preview) => preview.fieldDiffs.length > 0 || preview.pathDiff).length,
        completed: session.completedEntries,
        total: session.totalEntries,
      },
      error: session.error ?? undefined,
    };
  }
  if (job.kind === "person-sync") {
    const sync = await port.personSyncJob();
    if (sync?.id !== job.jobId) return { state: "stopped", outcome: { kind: "lost" } };
    return {
      state: endState(sync.status),
      outcome: {
        kind: "person-sync",
        current: sync.current,
        total: sync.total,
        processed: sync.result?.processedCount ?? 0,
        failed: sync.result?.failedCount ?? 0,
        skipped: sync.result?.skippedCount ?? 0,
      },
      error: sync.error ?? undefined,
    };
  }
  const edit = await port.editJob();
  if (edit?.id !== job.jobId) return { state: "stopped", outcome: { kind: "lost" } };
  return {
    state: endState(edit.status),
    outcome: {
      kind: "edit",
      current: edit.current,
      total: edit.total,
      changed: edit.changed,
      unchanged: edit.unchanged,
      skipped: edit.skipped,
      failed: edit.failures.length,
    },
    error: edit.error ?? undefined,
  };
};

/**
 * Follows the jobs of confirmed cells wherever the user is, so the page and the sidebar badge both read the store. A
 * job too old for the server to know shows the outcome the cell stored last.
 */
export function useBriefJobFollower(port: BriefPort | null): void {
  useEffect(() => {
    if (!port) return;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const followed = useBriefStore
          .getState()
          .cells.filter((cell) => cell.state === "running" || cell.state === "review");
        for (const cell of followed) {
          const result = await readJob(cell, port);
          if (!result) continue;
          useBriefStore.getState().updateCell(cell.id, (current) => ({
            state: result.state,
            outcome: result.outcome,
            error: result.error,
            finishedAt:
              result.state !== "running" && result.state !== current.state
                ? new Date().toISOString()
                : current.finishedAt,
          }));
        }
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [port]);
}
