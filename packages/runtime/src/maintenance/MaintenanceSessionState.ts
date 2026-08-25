import { randomUUID } from "node:crypto";
import type {
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenanceLibrarySource,
  MaintenanceSessionDraft,
  MaintenanceTaskApplyItemStatus,
  MaintenanceTaskEvent,
  MaintenanceTaskPreview,
  MaintenanceTaskProgress,
  MaintenanceTaskRef,
  MaintenanceTaskStatus,
} from "@mdcz/shared/maintenanceTasks";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import type { MaintenanceRuntimePreviewItem } from "./MaintenanceRuntime";

export const PREVIEW_ALL_FAILED = "维护预览全部失败";
export const APPLY_FAILED = "维护应用失败";
export const STOPPED = "维护已停止";
export const STOPPED_ITEM = "维护已停止，项目未执行";
export const INTERRUPTED = "维护因服务关闭而中断，请重新预览后执行";
export const OWNERSHIP_CHANGED = "Maintenance execution ownership changed";

export const ACTIVE_MAINTENANCE_STATUSES: readonly MaintenanceTaskStatus[] = [
  "queued",
  "running",
  "paused",
  "stopping",
];

export const TERMINAL_MAINTENANCE_ITEM_STATUSES = new Set<MaintenanceTaskApplyItemStatus>([
  "success",
  "failed",
  "skipped",
]);

export type MaintenanceSessionTimestamps = {
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type MaintenanceCurrentBatchItem = {
  id: string;
  selection: MaintenanceApplySelection;
  status: MaintenanceTaskApplyItemStatus;
  error: string | null;
  result?: MaintenanceApplyItemResult;
  createdAt: Date;
  updatedAt: Date;
};

export type MaintenanceCurrentBatch = {
  id: string;
  items: Map<string, MaintenanceCurrentBatchItem>;
};

export type MaintenanceSessionState = {
  id: string;
  rootId: string;
  presetId: MaintenancePresetId;
  phase: "preview" | "apply";
  status: MaintenanceTaskStatus;
  generation: number;
  refs: MaintenanceTaskRef[];
  progress: MaintenanceTaskProgress;
  timestamps: MaintenanceSessionTimestamps;
  error: string | null;
  previews: Map<string, MaintenanceTaskPreview>;
  currentBatch: MaintenanceCurrentBatch | null;
  draft: MaintenanceSessionDraft;
  events: MaintenanceTaskEvent[];
};

const copySelection = (selection: MaintenanceApplySelection): MaintenanceApplySelection => ({
  previewId: selection.previewId,
  ...(selection.fieldSelections ? { fieldSelections: { ...selection.fieldSelections } } : {}),
});

export const isActiveMaintenanceSession = (session: MaintenanceSessionState): boolean =>
  ACTIVE_MAINTENANCE_STATUSES.includes(session.status);

export const emptyMaintenanceProgress = (totalEntries: number): MaintenanceTaskProgress => ({
  totalEntries,
  completedEntries: 0,
  successCount: 0,
  failedCount: 0,
});

export const assertUniqueMaintenanceRefs = (refs: readonly MaintenanceTaskRef[]): void => {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref.relativePath.trim()) throw new Error("维护文件相对路径不能为空");
    if (seen.has(ref.relativePath)) throw new Error(`维护文件路径重复：${ref.relativePath}`);
    seen.add(ref.relativePath);
  }
};

/** Owns the sole process-local maintenance session and its generation fence. */
export class MaintenanceSessionStore {
  private session: MaintenanceSessionState | null = null;

  get current(): MaintenanceSessionState | null {
    return this.session;
  }

  createPreviewSession(input: {
    rootId: string;
    presetId: MaintenancePresetId;
    refs: readonly MaintenanceTaskRef[];
  }): MaintenanceSessionState {
    const refs = input.refs.map((ref) => ({ ...ref }));
    assertUniqueMaintenanceRefs(refs);
    if (this.session && isActiveMaintenanceSession(this.session)) {
      throw new Error("已有活动的维护会话，请先完成或停止当前会话");
    }

    const now = new Date();
    const generation = (this.session?.generation ?? 0) + 1;
    if (this.session) this.session.generation = generation;
    this.session = {
      id: randomUUID(),
      rootId: input.rootId,
      presetId: input.presetId,
      phase: "preview",
      status: "queued",
      generation,
      refs,
      progress: emptyMaintenanceProgress(refs.length),
      timestamps: { createdAt: now, updatedAt: now, startedAt: null, completedAt: null },
      error: null,
      previews: new Map(),
      currentBatch: null,
      draft: { fieldSelections: {}, imageSelections: {} },
      events: [],
    };
    return this.session;
  }

  beginApply(input: { taskId: string; selections: readonly MaintenanceApplySelection[] }): {
    session: MaintenanceSessionState;
    batchId: string;
    selectedIds: ReadonlySet<string>;
  } {
    if (input.selections.length === 0) throw new Error("请选择要应用的维护预览");
    const previewIds = input.selections.map((selection) => selection.previewId);
    if (new Set(previewIds).size !== previewIds.length) throw new Error("维护预览 ID 重复");

    const session = this.require(input.taskId);
    if (session.status !== "completed" && session.status !== "failed") {
      throw new Error("维护预览生成完成后才能应用");
    }
    for (const previewId of previewIds) {
      const preview = session.previews.get(previewId);
      if (!preview || (preview.status !== "ready" && preview.status !== "blocked")) {
        throw new Error("部分维护预览不存在、已提交或不属于当前会话");
      }
    }

    const now = new Date();
    const batchId = randomUUID();
    const items = new Map<string, MaintenanceCurrentBatchItem>();
    for (const original of input.selections) {
      const selection = copySelection(original);
      items.set(selection.previewId, {
        id: randomUUID(),
        selection,
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      });
      if (selection.fieldSelections) {
        session.draft.fieldSelections[selection.previewId] = { ...selection.fieldSelections };
      }
    }
    session.generation += 1;
    session.phase = "apply";
    session.status = "queued";
    session.currentBatch = { id: batchId, items };
    session.progress = emptyMaintenanceProgress(items.size);
    session.error = null;
    session.timestamps = {
      ...session.timestamps,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    return { session, batchId, selectedIds: new Set(previewIds) };
  }

  start(sessionId: string, generation: number): MaintenanceSessionState {
    const session = this.assertCurrent(sessionId, generation, ["queued", "paused"]);
    const now = new Date();
    session.status = "running";
    session.error = null;
    session.timestamps = {
      ...session.timestamps,
      startedAt: session.timestamps.startedAt ?? now,
      completedAt: null,
      updatedAt: now,
    };
    return session;
  }

  pause(taskId: string): MaintenanceSessionState {
    const session = this.require(taskId);
    if (session.status !== "queued" && session.status !== "running") return session;
    session.status = "paused";
    session.error = null;
    this.touch(session);
    return session;
  }

  beginStopping(taskId: string, error: string): { session: MaintenanceSessionState; generation: number } {
    const session = this.require(taskId);
    session.generation += 1;
    session.status = "stopping";
    session.error = error;
    this.touch(session);
    return { session, generation: session.generation };
  }

  discard(taskId?: string): string | null {
    if (!this.session) return null;
    if (taskId && this.session.id !== taskId) throw new Error("维护会话已变化");
    if (isActiveMaintenanceSession(this.session)) throw new Error("维护会话仍在运行，请先停止后再返回设置");
    const discardedId = this.session.id;
    this.session.generation += 1;
    this.session = null;
    return discardedId;
  }

  replaceScannedRefs(
    sessionId: string,
    generation: number,
    refs: readonly MaintenanceTaskRef[],
  ): MaintenanceSessionState {
    assertUniqueMaintenanceRefs(refs);
    const session = this.assertCurrent(sessionId, generation, ["running", "paused"]);
    session.refs = refs.map((ref) => ({ ...ref }));
    session.progress = emptyMaintenanceProgress(refs.length);
    this.touch(session);
    return session;
  }

  commitPreview(
    sessionId: string,
    generation: number,
    item: MaintenanceRuntimePreviewItem,
    librarySource: MaintenanceLibrarySource | null,
  ): { session: MaintenanceSessionState; preview: MaintenanceTaskPreview } {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused"]);
    const now = new Date();
    const preview: MaintenanceTaskPreview = {
      id: randomUUID(),
      taskId: session.id,
      rootId: item.rootId,
      relativePath: item.relativePath,
      presetId: session.presetId,
      status: item.status,
      error: item.error,
      fieldDiffs: item.fieldDiffs,
      unchangedFieldDiffs: item.unchangedFieldDiffs,
      pathDiff: item.pathDiff,
      proposedCrawlerData: item.proposedCrawlerData,
      imageAlternatives: item.imageAlternatives,
      entry: item.entry,
      librarySource: librarySource ?? undefined,
      createdAt: now,
      updatedAt: now,
    };
    const duplicate = [...session.previews.values()].find(
      (existing) => existing.relativePath === preview.relativePath && existing.id !== preview.id,
    );
    if (duplicate) throw new Error(`维护预览路径重复：${preview.relativePath}`);
    session.previews.set(preview.id, preview);
    session.progress = {
      totalEntries: session.progress.totalEntries,
      completedEntries: session.progress.completedEntries + 1,
      successCount: session.progress.successCount + (preview.status === "ready" ? 1 : 0),
      failedCount: session.progress.failedCount + (preview.status === "blocked" ? 1 : 0),
    };
    this.touch(session);
    return { session, preview };
  }

  markApplyProcessing(
    sessionId: string,
    generation: number,
    item: MaintenanceCurrentBatchItem,
  ): {
    session: MaintenanceSessionState;
    item: MaintenanceCurrentBatchItem;
    preview: MaintenanceTaskPreview | undefined;
  } {
    const session = this.assertCurrent(sessionId, generation, ["running"]);
    const batchItem = session.currentBatch?.items.get(item.selection.previewId);
    if (!batchItem || batchItem.id !== item.id || batchItem.status !== "pending") {
      throw new Error(OWNERSHIP_CHANGED);
    }
    batchItem.status = "processing";
    batchItem.error = null;
    batchItem.updatedAt = new Date();
    this.touch(session);
    return { session, item: batchItem, preview: session.previews.get(item.selection.previewId) };
  }

  commitApplyItem(
    sessionId: string,
    generation: number,
    item: MaintenanceCurrentBatchItem,
    result: MaintenanceApplyItemResult,
  ): { session: MaintenanceSessionState; item: MaintenanceCurrentBatchItem; preview: MaintenanceTaskPreview } | null {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused", "stopping"]);
    const current = session.currentBatch?.items.get(item.selection.previewId);
    if (!current || current.id !== item.id || TERMINAL_MAINTENANCE_ITEM_STATUSES.has(current.status)) return null;
    const preview = session.previews.get(item.selection.previewId);
    if (!preview) return null;
    const now = new Date();
    current.status = result.status;
    current.error = result.error ?? null;
    current.result = result;
    current.updatedAt = now;
    preview.status = result.status === "success" ? "applied" : "failed";
    preview.error = result.error ?? null;
    preview.updatedAt = now;
    delete session.draft.fieldSelections[preview.id];
    delete session.draft.imageSelections[preview.id];
    session.progress = {
      totalEntries: session.progress.totalEntries,
      completedEntries: session.progress.completedEntries + 1,
      successCount: session.progress.successCount + (result.status === "success" ? 1 : 0),
      failedCount: session.progress.failedCount + (result.status === "success" ? 0 : 1),
    };
    this.touch(session, now);
    return { session, item: current, preview };
  }

  finish(
    sessionId: string,
    generation: number,
    status: "completed" | "failed",
    error: string | null,
  ): MaintenanceSessionState {
    const session = this.assertCurrent(sessionId, generation, ["running", "stopping"]);
    const now = new Date();
    session.status = status;
    session.error = error;
    session.timestamps = { ...session.timestamps, completedAt: now, updatedAt: now };
    return session;
  }

  fail(sessionId: string, generation: number, error: string): MaintenanceSessionState | null {
    if (!this.isCurrent(sessionId, generation)) return null;
    const session = this.require(sessionId);
    if (session.status !== "running" && session.status !== "stopping") return null;
    return this.finish(sessionId, generation, "failed", error);
  }

  pendingBatchItems(session: MaintenanceSessionState): MaintenanceCurrentBatchItem[] {
    return session.currentBatch
      ? [...session.currentBatch.items.values()]
          .filter((item) => item.status === "pending")
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      : [];
  }

  pendingOrProcessingBatchItems(session: MaintenanceSessionState): MaintenanceCurrentBatchItem[] {
    return session.currentBatch
      ? [...session.currentBatch.items.values()].filter(
          (item) => item.status === "pending" || item.status === "processing",
        )
      : [];
  }

  isCurrent(sessionId: string, generation: number): boolean {
    return Boolean(this.session && this.session.id === sessionId && this.session.generation === generation);
  }

  assertCurrent(
    sessionId: string,
    generation: number,
    statuses?: readonly MaintenanceTaskStatus[],
  ): MaintenanceSessionState {
    const session = this.session;
    if (!session || session.id !== sessionId || session.generation !== generation) throw new Error(OWNERSHIP_CHANGED);
    if (statuses && !statuses.includes(session.status)) throw new Error(OWNERSHIP_CHANGED);
    return session;
  }

  require(taskId: string): MaintenanceSessionState {
    if (!this.session || this.session.id !== taskId) throw new Error(`Maintenance task not found: ${taskId}`);
    return this.session;
  }

  touch(session: MaintenanceSessionState, now = new Date()): void {
    session.timestamps.updatedAt = now;
  }
}
