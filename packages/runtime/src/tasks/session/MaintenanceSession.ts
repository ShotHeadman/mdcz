import { randomUUID } from "node:crypto";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenanceSessionDraft,
  MaintenanceTaskApplyItemStatus,
  MaintenanceTaskApplyLog,
  MaintenanceTaskPreview,
  MaintenanceTaskProgress,
  MaintenanceTaskRef,
  MaintenanceTaskSnapshot,
  MaintenanceTaskStatus,
} from "@mdcz/shared/maintenanceTasks";
import type { MaintenancePresetId } from "@mdcz/shared/types";

export const ACTIVE_MAINTENANCE_STATUSES: readonly MaintenanceTaskStatus[] = [
  "queued",
  "running",
  "paused",
  "stopping",
];

const TERMINAL_ITEM_STATUSES = new Set<MaintenanceTaskApplyItemStatus>(["success", "failed", "skipped"]);

export interface MaintenanceBatchItem {
  id: string;
  selection: MaintenanceApplySelection;
  status: MaintenanceTaskApplyItemStatus;
  error: string | null;
  result?: MaintenanceApplyItemResult;
  createdAt: Date;
  updatedAt: Date;
}

export class StaleMaintenanceGenerationError extends Error {}

export class MaintenanceSession {
  readonly id: string;
  readonly rootId: string;
  readonly presetId: MaintenancePresetId;
  private phaseValue: "preview" | "apply" = "preview";
  private statusValue: MaintenanceTaskStatus = "queued";
  private generationValue: number;
  private refsValue: MaintenanceTaskRef[];
  private timestamps: { createdAt: Date; updatedAt: Date; startedAt: Date | null; completedAt: Date | null };
  private errorValue: string | null = null;
  private readonly previews = new Map<string, MaintenanceTaskPreview>();
  private currentBatch: { id: string; items: Map<string, MaintenanceBatchItem> } | null = null;
  private readonly draft: MaintenanceSessionDraft = { fieldSelections: {} };

  constructor(input: {
    id: string;
    rootId: string;
    presetId: MaintenancePresetId;
    refs: readonly MaintenanceTaskRef[];
    generation: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    this.id = input.id;
    this.rootId = input.rootId;
    this.presetId = input.presetId;
    this.generationValue = input.generation;
    this.refsValue = input.refs.map((ref) => ({ ...ref }));
    this.timestamps = { createdAt: now, updatedAt: now, startedAt: null, completedAt: null };
  }

  get phase(): "preview" | "apply" {
    return this.phaseValue;
  }

  get status(): MaintenanceTaskStatus {
    return this.statusValue;
  }

  get generation(): number {
    return this.generationValue;
  }

  get refs(): readonly MaintenanceTaskRef[] {
    return this.refsValue;
  }

  get error(): string | null {
    return this.errorValue;
  }

  isActive(): boolean {
    return ACTIVE_MAINTENANCE_STATUSES.includes(this.statusValue);
  }

  assertGeneration(generation: number, statuses?: readonly MaintenanceTaskStatus[]): void {
    if (this.generationValue !== generation || (statuses && !statuses.includes(this.statusValue))) {
      throw new StaleMaintenanceGenerationError(`Stale maintenance result for ${this.id}`);
    }
  }

  setDiscoveredRefs(refs: readonly MaintenanceTaskRef[], generation: number): void {
    this.assertGeneration(generation, ["running", "paused"]);
    this.refsValue = refs.map((ref) => ({ ...ref }));
    this.touch();
  }

  startRunning(generation: number): void {
    this.assertGeneration(generation, ["queued", "paused"]);
    const now = new Date();
    this.statusValue = "running";
    this.errorValue = null;
    this.timestamps = {
      ...this.timestamps,
      startedAt: this.timestamps.startedAt ?? now,
      completedAt: null,
      updatedAt: now,
    };
  }

  pause(): boolean {
    if (this.statusValue !== "queued" && this.statusValue !== "running") return false;
    this.statusValue = "paused";
    this.errorValue = null;
    this.touch();
    return true;
  }

  beginApply(selections: readonly MaintenanceApplySelection[]): { generation: number; batchId: string } {
    if (this.statusValue !== "completed" && this.statusValue !== "failed") {
      throw new Error("维护预览生成完成后才能应用");
    }
    const previewIds = selections.map((selection) => selection.previewId);
    if (new Set(previewIds).size !== previewIds.length) throw new Error("维护预览 ID 重复");
    for (const previewId of previewIds) {
      const preview = this.previews.get(previewId);
      if (!preview || (preview.status !== "ready" && preview.status !== "blocked")) {
        throw new Error("部分维护预览不存在、已提交或不属于当前会话");
      }
    }

    const now = new Date();
    const items = new Map<string, MaintenanceBatchItem>();
    for (const original of selections) {
      const selection = {
        previewId: original.previewId,
        ...(original.fieldSelections ? { fieldSelections: { ...original.fieldSelections } } : {}),
      };
      items.set(selection.previewId, {
        id: randomUUID(),
        selection,
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      });
      if (selection.fieldSelections) this.draft.fieldSelections[selection.previewId] = { ...selection.fieldSelections };
    }
    this.generationValue += 1;
    this.phaseValue = "apply";
    this.statusValue = "queued";
    this.currentBatch = { id: randomUUID(), items };
    this.errorValue = null;
    this.timestamps = { ...this.timestamps, updatedAt: now, startedAt: null, completedAt: null };
    return { generation: this.generationValue, batchId: this.currentBatch.id };
  }

  beginStopping(error: string): number {
    if (this.statusValue === "completed" || this.statusValue === "failed" || this.statusValue === "stopping") {
      return this.generationValue;
    }
    this.generationValue += 1;
    this.statusValue = "stopping";
    this.errorValue = error;
    this.touch();
    return this.generationValue;
  }

  invalidate(): void {
    this.generationValue += 1;
  }

  finish(generation: number, status: "completed" | "failed", error: string | null): void {
    this.assertGeneration(generation, ["running", "stopping"]);
    const now = new Date();
    this.statusValue = status;
    this.errorValue = error;
    this.timestamps = { ...this.timestamps, completedAt: now, updatedAt: now };
  }

  addPreview(
    generation: number,
    preview: Omit<MaintenanceTaskPreview, "id" | "taskId" | "presetId" | "createdAt" | "updatedAt">,
  ): void {
    this.assertGeneration(generation, ["running", "paused"]);
    if ([...this.previews.values()].some((existing) => existing.relativePath === preview.relativePath)) {
      throw new Error(`维护预览路径重复：${preview.relativePath}`);
    }
    const now = new Date();
    const item: MaintenanceTaskPreview = {
      ...preview,
      id: randomUUID(),
      taskId: this.id,
      presetId: this.presetId,
      createdAt: now,
      updatedAt: now,
    };
    this.previews.set(item.id, item);
    this.touch(now);
  }

  preview(previewId: string): MaintenanceTaskPreview | undefined {
    const preview = this.previews.get(previewId);
    return preview ? this.clonePreview(preview) : undefined;
  }

  updateDraft(previewId: string, fieldSelections?: Record<string, "old" | "new">): void {
    const preview = this.previews.get(previewId);
    if (!preview || (preview.status !== "ready" && preview.status !== "blocked")) {
      throw new Error("维护预览不存在或已提交");
    }
    if (fieldSelections) this.draft.fieldSelections[previewId] = { ...fieldSelections };
    this.touch();
  }

  markApplyProcessing(
    generation: number,
    item: MaintenanceBatchItem,
  ): {
    item: MaintenanceBatchItem;
    preview?: MaintenanceTaskPreview;
  } {
    this.assertGeneration(generation, ["running"]);
    const current = this.currentBatch?.items.get(item.selection.previewId);
    if (!current || current.id !== item.id || current.status !== "pending") {
      throw new StaleMaintenanceGenerationError(`Stale maintenance item for ${this.id}`);
    }
    current.status = "processing";
    current.error = null;
    current.updatedAt = new Date();
    this.touch();
    return { item: this.cloneBatchItem(current), preview: this.preview(item.selection.previewId) };
  }

  commitItem(generation: number, item: MaintenanceBatchItem, result: MaintenanceApplyItemResult): boolean {
    this.assertGeneration(generation, ["running", "paused", "stopping"]);
    const current = this.currentBatch?.items.get(item.selection.previewId);
    if (!current || current.id !== item.id || TERMINAL_ITEM_STATUSES.has(current.status)) return false;
    const preview = this.previews.get(item.selection.previewId);
    if (!preview) return false;
    const now = new Date();
    current.status = result.status;
    current.error = result.error ?? null;
    current.result = result;
    current.updatedAt = now;
    preview.status = result.status === "success" ? "applied" : "failed";
    preview.error = result.error ?? null;
    preview.updatedAt = now;
    delete this.draft.fieldSelections[preview.id];
    this.touch(now);
    return true;
  }

  skipOutstanding(generation: number, error: string): boolean {
    this.assertGeneration(generation, ["running", "paused", "stopping"]);
    let changed = false;
    for (const item of this.currentBatch?.items.values() ?? []) {
      if (item.status !== "pending" && item.status !== "processing") continue;
      changed = this.commitItem(generation, item, { status: "skipped", error }) || changed;
    }
    return changed;
  }

  pendingBatchItems(): MaintenanceBatchItem[] {
    return this.currentBatch
      ? [...this.currentBatch.items.values()]
          .filter((item) => item.status === "pending")
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
          .map((item) => this.cloneBatchItem(item))
      : [];
  }

  editablePreviews(): MaintenanceTaskPreview[] {
    return [...this.previews.values()]
      .filter((preview) => preview.status === "ready" || preview.status === "blocked")
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
      .map((preview) => this.clonePreview(preview));
  }

  applyLogs(): MaintenanceTaskApplyLog[] {
    if (!this.currentBatch) return [];
    return [...this.currentBatch.items.values()]
      .filter((item) => TERMINAL_ITEM_STATUSES.has(item.status))
      .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
      .flatMap((item) => {
        const preview = this.previews.get(item.selection.previewId);
        return preview
          ? [
              {
                id: item.id,
                taskId: this.id,
                batchId: this.currentBatch?.id ?? "",
                previewId: preview.id,
                rootId: preview.rootId,
                relativePath: preview.relativePath,
                presetId: preview.presetId,
                status: item.status as "success" | "failed" | "skipped",
                error: item.error,
                appliedAt: new Date(item.updatedAt),
              },
            ]
          : [];
      });
  }

  progress(): MaintenanceTaskProgress {
    if (this.phaseValue === "preview") {
      const previews = [...this.previews.values()];
      return {
        totalEntries: this.refsValue.length,
        completedEntries: previews.length,
        successCount: previews.filter((preview) => preview.status === "ready").length,
        failedCount: previews.filter((preview) => preview.status === "blocked").length,
      };
    }
    const items = this.currentBatch ? [...this.currentBatch.items.values()] : [];
    const terminal = items.filter((item) => TERMINAL_ITEM_STATUSES.has(item.status));
    return {
      totalEntries: items.length,
      completedEntries: terminal.length,
      successCount: terminal.filter((item) => item.status === "success").length,
      failedCount: terminal.filter((item) => item.status !== "success").length,
    };
  }

  taskSnapshot(): MaintenanceTaskSnapshot {
    return {
      id: this.id,
      rootId: this.rootId,
      status: this.statusValue,
      ...this.progress(),
      createdAt: new Date(this.timestamps.createdAt),
      updatedAt: new Date(this.timestamps.updatedAt),
      startedAt: this.timestamps.startedAt ? new Date(this.timestamps.startedAt) : null,
      completedAt: this.timestamps.completedAt ? new Date(this.timestamps.completedAt) : null,
      error: this.errorValue,
    };
  }

  snapshot(): MaintenanceActiveSessionSnapshot {
    return {
      id: this.id,
      rootId: this.rootId,
      presetId: this.presetId,
      phase: this.phaseValue,
      status: this.statusValue,
      generation: this.generationValue,
      refs: this.refsValue.map((ref) => ({ ...ref })),
      ...this.progress(),
      timestamps: {
        createdAt: new Date(this.timestamps.createdAt),
        updatedAt: new Date(this.timestamps.updatedAt),
        startedAt: this.timestamps.startedAt ? new Date(this.timestamps.startedAt) : null,
        completedAt: this.timestamps.completedAt ? new Date(this.timestamps.completedAt) : null,
      },
      error: this.errorValue,
      previews: this.editablePreviews(),
      currentBatch: this.currentBatch
        ? {
            id: this.currentBatch.id,
            items: [...this.currentBatch.items.values()].map((item) => this.cloneBatchItem(item)),
          }
        : null,
      draft: {
        fieldSelections: Object.fromEntries(
          Object.entries(this.draft.fieldSelections).map(([id, value]) => [id, { ...value }]),
        ),
      },
    };
  }

  private touch(now = new Date()): void {
    this.timestamps.updatedAt = now;
  }

  private clonePreview(preview: MaintenanceTaskPreview): MaintenanceTaskPreview {
    return structuredClone(preview);
  }

  private cloneBatchItem(item: MaintenanceBatchItem): MaintenanceBatchItem {
    return structuredClone(item);
  }
}
