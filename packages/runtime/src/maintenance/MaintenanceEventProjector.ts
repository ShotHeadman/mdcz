import { randomUUID } from "node:crypto";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyItemResult,
  MaintenanceExecutionState,
  MaintenanceTaskApplyLog,
  MaintenanceTaskApplyQueueItem,
  MaintenanceTaskEvent,
  MaintenanceTaskPreview,
  MaintenanceTaskSnapshot,
} from "@mdcz/shared/maintenanceTasks";
import type { LocalScanEntry } from "@mdcz/shared/types";
import type { MaintenanceCoordinatorEvent, MaintenanceCoordinatorEventSink } from "./coordinatorContracts";
import {
  type MaintenanceCurrentBatchItem,
  type MaintenanceSessionState,
  TERMINAL_MAINTENANCE_ITEM_STATUSES,
} from "./MaintenanceSessionState";

/** Converts the internal session into public snapshots and live events. */
export class MaintenanceEventProjector {
  constructor(
    private readonly sink: MaintenanceCoordinatorEventSink,
    private readonly onPublished: (taskId: string) => void,
  ) {}

  task(session: MaintenanceSessionState): MaintenanceTaskSnapshot {
    return {
      id: session.id,
      rootId: session.rootId,
      status: session.status,
      ...session.progress,
      createdAt: session.timestamps.createdAt,
      updatedAt: session.timestamps.updatedAt,
      startedAt: session.timestamps.startedAt,
      completedAt: session.timestamps.completedAt,
      error: session.error,
    };
  }

  execution(session: MaintenanceSessionState): MaintenanceExecutionState {
    return {
      taskId: session.id,
      presetId: session.presetId,
      phase: session.phase,
      batchId: session.currentBatch?.id ?? null,
      refs: session.refs.map((ref) => ({ ...ref })),
      ...session.progress,
      createdAt: session.timestamps.createdAt,
      updatedAt: session.timestamps.updatedAt,
    };
  }

  editablePreviews(session: MaintenanceSessionState): MaintenanceTaskPreview[] {
    return [...session.previews.values()]
      .filter((preview) => preview.status === "ready" || preview.status === "blocked")
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
  }

  applyItems(session: MaintenanceSessionState): MaintenanceTaskApplyQueueItem[] {
    if (!session.currentBatch) return [];
    return [...session.currentBatch.items.values()]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((item) => ({
        id: item.id,
        taskId: session.id,
        batchId: session.currentBatch?.id as string,
        previewId: item.selection.previewId,
        status: item.status,
        ...(item.selection.fieldSelections ? { fieldSelections: { ...item.selection.fieldSelections } } : {}),
        error: item.error,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }

  applyLogs(session: MaintenanceSessionState): MaintenanceTaskApplyLog[] {
    if (!session.currentBatch) return [];
    return [...session.currentBatch.items.values()]
      .filter((item) => TERMINAL_MAINTENANCE_ITEM_STATUSES.has(item.status))
      .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
      .flatMap((item) => {
        const preview = session.previews.get(item.selection.previewId);
        return preview ? [this.applyLog(session, item, preview)] : [];
      });
  }

  activeSession(session: MaintenanceSessionState): MaintenanceActiveSessionSnapshot {
    const recentItems = this.recentBatchItems(session);
    return {
      task: this.task(session),
      execution: this.execution(session),
      previews: this.editablePreviews(session),
      applyItems: this.applyItems(session),
      draft: {
        fieldSelections: Object.fromEntries(
          Object.entries(session.draft.fieldSelections).map(([id, value]) => [id, { ...value }]),
        ),
        imageSelections: Object.fromEntries(
          Object.entries(session.draft.imageSelections).map(([id, value]) => [id, { ...value }]),
        ),
      },
      recentBatch: session.currentBatch ? { batchId: session.currentBatch.id, items: recentItems } : null,
    };
  }

  async taskStatus(session: MaintenanceSessionState, type: string, message: string): Promise<void> {
    const event = this.addEvent(session, type, message);
    await this.publish({ kind: "task-changed", task: this.task(session) });
    await this.publish({ kind: "log", taskId: session.id, event });
  }

  async log(session: MaintenanceSessionState, type: string, message: string): Promise<void> {
    const event = this.addEvent(session, type, message);
    await this.publish({ kind: "log", taskId: session.id, event });
  }

  async previewItem(
    session: MaintenanceSessionState,
    preview: MaintenanceTaskPreview,
    entry: LocalScanEntry,
  ): Promise<void> {
    await this.publish({ kind: "preview-item", taskId: session.id, preview, entry });
    await this.publish({
      kind: "progress",
      taskId: session.id,
      phase: "preview",
      progress: { ...session.progress },
      message: preview.relativePath,
    });
  }

  async applyItem(
    session: MaintenanceSessionState,
    item: MaintenanceCurrentBatchItem,
    preview: MaintenanceTaskPreview,
    result: MaintenanceApplyItemResult,
  ): Promise<MaintenanceTaskApplyLog> {
    const log = this.applyLog(session, item, preview);
    await this.publish({ kind: "apply-item", taskId: session.id, log, result });
    await this.publish({
      kind: "progress",
      taskId: session.id,
      phase: "apply",
      progress: { ...session.progress },
      message: log.relativePath,
    });
    return log;
  }

  async failed(session: MaintenanceSessionState, error: string): Promise<void> {
    await this.publish({ kind: "task-failed", taskId: session.id, error });
  }

  private recentBatchItems(
    session: MaintenanceSessionState,
  ): Array<{ log: MaintenanceTaskApplyLog; result: MaintenanceApplyItemResult }> {
    if (!session.currentBatch) return [];
    return [...session.currentBatch.items.values()]
      .filter((item): item is MaintenanceCurrentBatchItem & { result: MaintenanceApplyItemResult } =>
        Boolean(item.result),
      )
      .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
      .flatMap((item) => {
        const preview = session.previews.get(item.selection.previewId);
        return preview ? [{ log: this.applyLog(session, item, preview), result: item.result }] : [];
      });
  }

  private applyLog(
    session: MaintenanceSessionState,
    item: MaintenanceCurrentBatchItem,
    preview: MaintenanceTaskPreview,
  ): MaintenanceTaskApplyLog {
    if (!session.currentBatch || !TERMINAL_MAINTENANCE_ITEM_STATUSES.has(item.status)) {
      throw new Error("Maintenance apply item is not terminal");
    }
    return {
      id: item.id,
      taskId: session.id,
      batchId: session.currentBatch.id,
      previewId: preview.id,
      rootId: preview.rootId,
      relativePath: preview.relativePath,
      presetId: preview.presetId,
      status: item.status as "success" | "failed" | "skipped",
      error: item.error,
      appliedAt: item.updatedAt,
    };
  }

  private addEvent(session: MaintenanceSessionState, type: string, message: string): MaintenanceTaskEvent {
    const event = { id: randomUUID(), taskId: session.id, type, message, createdAt: new Date() };
    session.events.push(event);
    return event;
  }

  private async publish(event: MaintenanceCoordinatorEvent): Promise<void> {
    await this.sink.publish(event);
    this.onPublished("taskId" in event ? event.taskId : event.task.id);
  }
}
