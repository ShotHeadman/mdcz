import { randomUUID } from "node:crypto";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenanceExecutionOwner,
  MaintenanceExecutionState,
  MaintenanceTaskApplyLog,
  MaintenanceTaskApplyQueueItem,
  MaintenanceTaskClaim,
  MaintenanceTaskEvent,
  MaintenanceTaskPatch,
  MaintenanceTaskPreview,
  MaintenanceTaskProgress,
  MaintenanceTaskRef,
  MaintenanceTaskSnapshot,
  MaintenanceTaskStatus,
} from "@mdcz/shared/maintenanceTasks";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import type { MaintenanceTaskStore } from "./coordinatorContracts";

type Session = {
  task: MaintenanceTaskSnapshot;
  execution: MaintenanceExecutionState;
  previews: Map<string, MaintenanceTaskPreview>;
  applyItems: Map<string, MaintenanceTaskApplyQueueItem>;
  applyLogs: MaintenanceTaskApplyLog[];
  applyResults: Map<string, MaintenanceApplyItemResult>;
  events: MaintenanceTaskEvent[];
  draft: MaintenanceActiveSessionSnapshot["draft"];
};

const ACTIVE_STATUSES: readonly MaintenanceTaskStatus[] = ["queued", "running", "paused", "stopping"];
const TERMINAL_ITEM_STATUSES = new Set(["success", "failed", "skipped"]);

const assertUniqueRefs = (refs: readonly MaintenanceTaskRef[]): void => {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref.relativePath.trim()) throw new Error("维护文件相对路径不能为空");
    if (seen.has(ref.relativePath)) throw new Error(`维护文件路径重复：${ref.relativePath}`);
    seen.add(ref.relativePath);
  }
};

const copyProgress = (progress: MaintenanceTaskProgress): MaintenanceTaskProgress => ({ ...progress });

export class InMemoryMaintenanceTaskStore implements MaintenanceTaskStore {
  private session: Session | null = null;

  async createPreviewExecution(input: {
    rootId: string;
    presetId: MaintenancePresetId;
    refs?: readonly MaintenanceTaskRef[];
  }): Promise<MaintenanceTaskSnapshot> {
    if (this.session && ACTIVE_STATUSES.includes(this.session.task.status)) {
      throw new Error("已有活动的维护会话，请先完成或停止当前会话");
    }
    const refs = [...(input.refs ?? [])];
    assertUniqueRefs(refs);
    const now = new Date();
    const taskId = randomUUID();
    const progress = { totalEntries: refs.length, completedEntries: 0, successCount: 0, failedCount: 0 };
    this.session = {
      task: {
        id: taskId,
        rootId: input.rootId,
        status: "queued",
        executionVersion: 0,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
        error: null,
        ...progress,
      },
      execution: {
        taskId,
        presetId: input.presetId,
        phase: "preview",
        batchId: null,
        refs,
        ...progress,
        createdAt: now,
        updatedAt: now,
      },
      previews: new Map(),
      applyItems: new Map(),
      applyLogs: [],
      applyResults: new Map(),
      events: [],
      draft: { fieldSelections: {}, imageSelections: {} },
    };
    this.addEvent("queued", `Maintenance task queued. Preset: ${input.presetId}`, now);
    this.addEvent("preset", `Maintenance preset: ${input.presetId}`, now);
    return this.snapshotTask();
  }

  async claimNext(): Promise<MaintenanceTaskClaim | null> {
    const session = this.session;
    if (!session || session.task.status !== "queued") return null;
    const now = new Date();
    session.task = {
      ...session.task,
      status: "running",
      executionVersion: session.task.executionVersion + 1,
      startedAt: now,
      completedAt: null,
      error: null,
      updatedAt: now,
    };
    this.addEvent("running", `Starting maintenance ${session.execution.phase}`, now);
    return {
      id: session.task.id,
      task: this.snapshotTask(),
      phase: session.execution.phase,
      execution: this.snapshotExecution(),
    };
  }

  async readTask(taskId: string): Promise<MaintenanceTaskSnapshot> {
    this.requireSession(taskId);
    return this.snapshotTask();
  }

  async listTasks(): Promise<MaintenanceTaskSnapshot[]> {
    return this.session ? [this.snapshotTask()] : [];
  }

  async readExecution(taskId: string): Promise<MaintenanceExecutionState> {
    this.requireSession(taskId);
    return this.snapshotExecution();
  }

  async listPreviews(taskId: string): Promise<MaintenanceTaskPreview[]> {
    const session = this.requireSession(taskId);
    return [...session.previews.values()].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, "zh-CN"),
    );
  }

  async listPendingApplyItems(taskId: string): Promise<MaintenanceTaskApplyQueueItem[]> {
    const session = this.requireSession(taskId);
    return [...session.applyItems.values()]
      .filter((item) => item.status === "pending")
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async listApplyLogs(taskId: string): Promise<MaintenanceTaskApplyLog[]> {
    return [...this.requireSession(taskId).applyLogs];
  }

  async listEvents(taskId: string): Promise<MaintenanceTaskEvent[]> {
    return [...this.requireSession(taskId).events];
  }

  async persistDiscoveredRefs(
    owner: MaintenanceExecutionOwner,
    refs: readonly MaintenanceTaskRef[],
  ): Promise<MaintenanceTaskSnapshot | null> {
    assertUniqueRefs(refs);
    if (!this.isOwned(owner, ["running"])) return null;
    const session = this.requireSession(owner.taskId);
    const now = new Date();
    const progress = { totalEntries: refs.length, completedEntries: 0, successCount: 0, failedCount: 0 };
    session.execution = { ...session.execution, refs: [...refs], ...progress, updatedAt: now };
    session.task = { ...session.task, ...progress, updatedAt: now };
    return this.snapshotTask();
  }

  async commitPreviewItem(
    owner: MaintenanceExecutionOwner,
    input: { preview: MaintenanceTaskPreview; progress: MaintenanceTaskProgress },
  ): Promise<MaintenanceTaskPreview | null> {
    if (!this.isOwned(owner, ["running", "paused"])) return null;
    const session = this.requireSession(owner.taskId);
    const duplicate = [...session.previews.values()].find(
      (preview) => preview.relativePath === input.preview.relativePath && preview.id !== input.preview.id,
    );
    if (duplicate) throw new Error(`维护预览路径重复：${input.preview.relativePath}`);
    const preview = { ...input.preview, updatedAt: new Date() };
    session.previews.set(preview.id, preview);
    this.writeProgress(input.progress);
    return preview;
  }

  async queueApply(input: {
    taskId: string;
    expectedExecutionVersion: number;
    selections: readonly MaintenanceApplySelection[];
    patch: MaintenanceTaskPatch;
  }): Promise<MaintenanceTaskSnapshot | null> {
    if (input.selections.length === 0) throw new Error("请选择要应用的维护预览");
    const session = this.requireSession(input.taskId);
    if (
      !["completed", "failed"].includes(session.task.status) ||
      session.task.executionVersion !== input.expectedExecutionVersion
    ) {
      return null;
    }
    const previewIds = input.selections.map((selection) => selection.previewId);
    if (new Set(previewIds).size !== previewIds.length) throw new Error("维护预览 ID 重复");
    if (previewIds.some((previewId) => !session.previews.has(previewId))) {
      throw new Error("部分维护预览不存在、已提交或不属于当前会话");
    }

    const now = new Date();
    const batchId = randomUUID();
    session.applyItems.clear();
    session.applyLogs = [];
    session.applyResults.clear();
    for (const selection of input.selections) {
      const item: MaintenanceTaskApplyQueueItem = {
        id: randomUUID(),
        taskId: input.taskId,
        batchId,
        previewId: selection.previewId,
        status: "pending",
        fieldSelections: selection.fieldSelections,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      session.applyItems.set(item.id, item);
      if (selection.fieldSelections) {
        session.draft.fieldSelections[selection.previewId] = { ...selection.fieldSelections };
      }
    }
    const progress = input.patch.progress ?? {
      totalEntries: input.selections.length,
      completedEntries: 0,
      successCount: 0,
      failedCount: 0,
    };
    session.execution = { ...session.execution, phase: "apply", batchId, ...progress, updatedAt: now };
    this.applyPatch(input.patch, now);
    if (input.patch.event) this.addEvent(input.patch.event.type, input.patch.event.message, now);
    return this.snapshotTask();
  }

  async markApplyItemProcessing(owner: MaintenanceExecutionOwner, itemId: string): Promise<boolean> {
    if (!this.isOwned(owner, ["running"])) return false;
    const session = this.requireSession(owner.taskId);
    const item = session.applyItems.get(itemId);
    if (!item || item.status !== "pending") return false;
    session.applyItems.set(itemId, { ...item, status: "processing", error: null, updatedAt: new Date() });
    return true;
  }

  async commitApplyItem(
    owner: MaintenanceExecutionOwner,
    itemId: string,
    result: MaintenanceApplyItemResult,
  ): Promise<MaintenanceTaskApplyLog | null> {
    if (!this.isOwned(owner, ["queued", "running", "paused", "stopping"])) return null;
    const session = this.requireSession(owner.taskId);
    const item = session.applyItems.get(itemId);
    if (!item || TERMINAL_ITEM_STATUSES.has(item.status)) return null;
    const preview = session.previews.get(item.previewId);
    if (!preview) return null;
    const now = new Date();
    const log: MaintenanceTaskApplyLog = {
      id: randomUUID(),
      taskId: owner.taskId,
      batchId: item.batchId,
      previewId: preview.id,
      rootId: preview.rootId,
      relativePath: preview.relativePath,
      presetId: preview.presetId,
      status: result.status,
      error: result.error ?? null,
      appliedAt: now,
    };
    session.applyItems.set(itemId, { ...item, status: result.status, error: result.error ?? null, updatedAt: now });
    session.applyLogs.push(log);
    session.applyResults.set(log.id, result);
    session.previews.delete(preview.id);
    delete session.draft.fieldSelections[preview.id];
    delete session.draft.imageSelections[preview.id];
    this.writeProgress({
      totalEntries: session.execution.totalEntries,
      completedEntries: session.execution.completedEntries + 1,
      successCount: session.execution.successCount + (result.status === "success" ? 1 : 0),
      failedCount: session.execution.failedCount + (result.status === "success" ? 0 : 1),
    });
    return log;
  }

  async transition(input: {
    owner: MaintenanceExecutionOwner;
    expectedStatus: MaintenanceTaskStatus | readonly MaintenanceTaskStatus[];
    patch: MaintenanceTaskPatch;
  }): Promise<MaintenanceTaskSnapshot | null> {
    const statuses = Array.isArray(input.expectedStatus) ? input.expectedStatus : [input.expectedStatus];
    if (!this.isOwned(input.owner, statuses)) return null;
    const now = new Date();
    this.applyPatch(input.patch, now);
    if (input.patch.progress) this.writeProgress(input.patch.progress);
    if (input.patch.event) this.addEvent(input.patch.event.type, input.patch.event.message, now);
    return this.snapshotTask();
  }

  async failInterruptedApply(owner: MaintenanceExecutionOwner, error: string): Promise<MaintenanceTaskSnapshot | null> {
    if (!this.isOwned(owner, ["running", "stopping"])) return null;
    for (const item of await this.listPendingApplyItems(owner.taskId)) {
      await this.commitApplyItem(owner, item.id, { status: "skipped", error });
    }
    const now = new Date();
    const session = this.requireSession(owner.taskId);
    session.task = { ...session.task, status: "failed", completedAt: now, error, updatedAt: now };
    this.addEvent("failed", error, now);
    return this.snapshotTask();
  }

  async getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null> {
    const session = this.session;
    if (!session) return null;
    const batchId = session.execution.batchId;
    return {
      task: this.snapshotTask(),
      execution: this.snapshotExecution(),
      previews: await this.listPreviews(session.task.id),
      applyItems: [...session.applyItems.values()]
        .map((item) => ({
          ...item,
          ...(item.fieldSelections ? { fieldSelections: { ...item.fieldSelections } } : {}),
        }))
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
      draft: {
        fieldSelections: Object.fromEntries(
          Object.entries(session.draft.fieldSelections).map(([id, value]) => [id, { ...value }]),
        ),
        imageSelections: Object.fromEntries(
          Object.entries(session.draft.imageSelections).map(([id, value]) => [id, { ...value }]),
        ),
      },
      recentBatch: batchId
        ? {
            batchId,
            items: session.applyLogs.map((log) => ({
              log,
              result: session.applyResults.get(log.id) ?? { status: log.status, error: log.error },
            })),
          }
        : null,
    };
  }

  async updateDraft(input: {
    taskId: string;
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
    imageSelections?: Record<string, string>;
  }): Promise<MaintenanceActiveSessionSnapshot> {
    const session = this.requireSession(input.taskId);
    if (!session.previews.has(input.previewId)) throw new Error("维护预览不存在或已提交");
    if (input.fieldSelections) session.draft.fieldSelections[input.previewId] = { ...input.fieldSelections };
    if (input.imageSelections) session.draft.imageSelections[input.previewId] = { ...input.imageSelections };
    return (await this.getActiveSession()) as MaintenanceActiveSessionSnapshot;
  }

  async discardSession(taskId?: string): Promise<void> {
    if (!this.session) return;
    if (taskId && this.session.task.id !== taskId) throw new Error("维护会话已变化");
    if (ACTIVE_STATUSES.includes(this.session.task.status)) throw new Error("维护会话仍在运行，请先停止后再返回设置");
    this.session = null;
  }

  private requireSession(taskId: string): Session {
    if (!this.session || this.session.task.id !== taskId) throw new Error(`Maintenance task not found: ${taskId}`);
    return this.session;
  }

  private isOwned(owner: MaintenanceExecutionOwner, statuses: readonly string[]): boolean {
    return Boolean(
      this.session &&
        this.session.task.id === owner.taskId &&
        this.session.task.executionVersion === owner.executionVersion &&
        statuses.includes(this.session.task.status),
    );
  }

  private writeProgress(progress: MaintenanceTaskProgress): void {
    if (!this.session) return;
    const now = new Date();
    this.session.execution = { ...this.session.execution, ...copyProgress(progress), updatedAt: now };
    this.session.task = { ...this.session.task, ...copyProgress(progress), updatedAt: now };
  }

  private applyPatch(patch: MaintenanceTaskPatch, now: Date): void {
    if (!this.session) return;
    this.session.task = {
      ...this.session.task,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
      ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      updatedAt: now,
    };
  }

  private addEvent(type: string, message: string, createdAt: Date): void {
    if (!this.session) return;
    this.session.events.push({ id: randomUUID(), taskId: this.session.task.id, type, message, createdAt });
  }

  private snapshotTask(): MaintenanceTaskSnapshot {
    if (!this.session) throw new Error("Maintenance session not found");
    return { ...this.session.task };
  }

  private snapshotExecution(): MaintenanceExecutionState {
    if (!this.session) throw new Error("Maintenance session not found");
    return { ...this.session.execution, refs: [...this.session.execution.refs] };
  }
}
