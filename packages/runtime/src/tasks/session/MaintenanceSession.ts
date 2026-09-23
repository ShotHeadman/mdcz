import { randomUUID } from "node:crypto";
import type { DirectoryTaskScope, DiscoveryProgress } from "@mdcz/shared/directoryTasks";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenanceSessionApplyItemStatus,
  MaintenanceSessionApplyLog,
  MaintenanceSessionDraft,
  MaintenanceSessionPreview,
  MaintenanceSessionProgress,
  MaintenanceSessionRef,
  MaintenanceSessionSnapshot,
  MaintenanceSessionStatus,
} from "@mdcz/shared/maintenanceTasks";
import type { LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";

export const ACTIVE_MAINTENANCE_STATUSES: readonly MaintenanceSessionStatus[] = [
  "queued",
  "discovering",
  "running",
  "paused",
  "stopping",
];

const TERMINAL_ITEM_STATUSES = new Set<MaintenanceSessionApplyItemStatus>(["success", "failed", "skipped"]);

export interface MaintenanceBatchItem {
  id: string;
  selection: MaintenanceApplySelection;
  status: MaintenanceSessionApplyItemStatus;
  error: string | null;
  result?: MaintenanceApplyItemResult;
  createdAt: Date;
  updatedAt: Date;
}

export class InactiveMaintenanceSessionError extends Error {}

export class MaintenanceSession {
  readonly id: string;
  readonly directoryScope?: DirectoryTaskScope;
  private discoveryValue?: DiscoveryProgress;
  private manifestFixed: boolean;
  readonly rootId: string;
  readonly presetId: MaintenancePresetId;
  readonly outputRootId: string;
  readonly outputRelativeDirectory: string;
  private phaseValue: "preview" | "apply" = "preview";
  private statusValue: MaintenanceSessionStatus = "queued";
  private refsValue: MaintenanceSessionRef[];
  private timestamps: { createdAt: Date; updatedAt: Date; startedAt: Date | null; completedAt: Date | null };
  private errorValue: string | null = null;
  private readonly previews = new Map<string, MaintenanceSessionPreview>();
  private currentBatch: { id: string; items: Map<string, MaintenanceBatchItem> } | null = null;
  private readonly draft: MaintenanceSessionDraft = { fieldSelections: {} };

  constructor(input: {
    id: string;
    directoryScope?: DirectoryTaskScope;
    rootId: string;
    presetId: MaintenancePresetId;
    refs: readonly MaintenanceSessionRef[];
    now?: Date;
    outputRootId?: string;
    outputRelativeDirectory?: string;
  }) {
    const now = input.now ?? new Date();
    this.id = input.id;
    this.directoryScope = input.directoryScope;
    this.manifestFixed = !input.directoryScope;
    this.rootId = input.rootId;
    this.presetId = input.presetId;
    this.outputRootId = input.outputRootId ?? input.rootId;
    this.outputRelativeDirectory = input.outputRelativeDirectory ?? "";
    this.refsValue = input.refs.map((ref) => ({ ...ref }));
    this.timestamps = { createdAt: now, updatedAt: now, startedAt: null, completedAt: null };
  }

  get phase(): "preview" | "apply" {
    return this.phaseValue;
  }

  get status(): MaintenanceSessionStatus {
    return this.statusValue;
  }

  get refs(): readonly MaintenanceSessionRef[] {
    return this.refsValue;
  }

  get error(): string | null {
    return this.errorValue;
  }

  isActive(): boolean {
    return ACTIVE_MAINTENANCE_STATUSES.includes(this.statusValue);
  }

  assertActive(statuses?: readonly MaintenanceSessionStatus[]): void {
    if (statuses && !statuses.includes(this.statusValue)) {
      throw new InactiveMaintenanceSessionError(`Inactive maintenance result for ${this.id}`);
    }
  }

  startRunning(): void {
    this.assertActive(["queued", "paused"]);
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

  startDiscovery(): void {
    this.assertActive(["running"]);
    this.statusValue = "discovering";
    this.touch();
  }

  recordDiscovery(progress: DiscoveryProgress): void {
    this.assertActive(["discovering", "stopping"]);
    this.discoveryValue = structuredClone(progress);
    this.touch();
  }

  fixDiscoveredRefs(refs: readonly MaintenanceSessionRef[]): void {
    this.assertActive(["discovering"]);
    if (this.manifestFixed) throw new Error("维护文件清单已固定");
    this.refsValue = refs.map((ref) => ({ ...ref }));
    this.manifestFixed = true;
    this.statusValue = "running";
    this.touch();
  }

  pause(): boolean {
    if (this.statusValue !== "queued" && this.statusValue !== "running") return false;
    this.statusValue = "paused";
    this.errorValue = null;
    this.touch();
    return true;
  }

  beginApply(selections: readonly MaintenanceApplySelection[]): { batchId: string } {
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
        ...((original.fieldSelections ?? this.draft.fieldSelections[original.previewId])
          ? {
              fieldSelections: {
                ...(original.fieldSelections ?? this.draft.fieldSelections[original.previewId]),
              },
            }
          : {}),
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
    this.phaseValue = "apply";
    this.statusValue = "queued";
    this.currentBatch = { id: randomUUID(), items };
    this.errorValue = null;
    this.timestamps = { ...this.timestamps, updatedAt: now, startedAt: null, completedAt: null };
    return { batchId: this.currentBatch.id };
  }

  beginStopping(error: string): void {
    if (["completed", "failed", "stopped", "interrupted", "stopping"].includes(this.statusValue)) {
      return;
    }
    this.statusValue = "stopping";
    this.errorValue = error;
    this.touch();
  }

  finish(status: "completed" | "failed" | "stopped" | "interrupted", error: string | null): void {
    this.assertActive(["running", "discovering", "stopping"]);
    const now = new Date();
    this.statusValue = status;
    this.errorValue = error;
    this.timestamps = { ...this.timestamps, completedAt: now, updatedAt: now };
  }

  private populateInitialEntries(entries: readonly LocalScanEntry[], now: Date): void {
    for (const entry of entries) {
      const item: MaintenanceSessionPreview = {
        id: randomUUID(),
        sessionId: this.id,
        rootId: entry.ref.rootId,
        relativePath: entry.ref.relativePath,
        presetId: this.presetId,
        status: "pending",
        error: null,
        fieldDiffs: [],
        unchangedFieldDiffs: [],
        pathDiff: null,
        proposedCrawlerData: null,
        entry,
        createdAt: now,
        updatedAt: now,
      };
      this.previews.set(item.id, item);
    }
  }

  initializeEntries(entries: readonly LocalScanEntry[]): void {
    this.assertActive(["running"]);
    if (this.previews.size) throw new Error("维护文件清单已初始化");
    this.populateInitialEntries(entries, new Date());
  }

  markPreviewProcessing(rootId: string, relativePath: string): MaintenanceSessionPreview | undefined {
    this.assertActive(["running"]);
    const preview = [...this.previews.values()].find(
      (item) => item.rootId === rootId && item.relativePath === relativePath,
    );
    if (!preview) return undefined;
    preview.status = "processing";
    preview.updatedAt = new Date();
    this.touch(preview.updatedAt);
    return this.clonePreview(preview);
  }

  commitPreview(
    preview: Omit<MaintenanceSessionPreview, "id" | "sessionId" | "presetId" | "createdAt" | "updatedAt">,
  ): MaintenanceSessionPreview {
    this.assertActive(["running", "paused", "stopping"]);
    const existing = [...this.previews.values()].find(
      (item) => item.rootId === preview.rootId && item.relativePath === preview.relativePath,
    );
    const now = new Date();
    if (existing) {
      existing.status = preview.status;
      existing.error = preview.error ?? null;
      existing.fieldDiffs = preview.fieldDiffs;
      existing.unchangedFieldDiffs = preview.unchangedFieldDiffs;
      existing.pathDiff = preview.pathDiff ?? null;
      existing.proposedCrawlerData = preview.proposedCrawlerData ?? null;
      existing.imageAlternatives = preview.imageAlternatives;
      existing.entry = preview.entry ?? existing.entry;
      existing.movieGroup = preview.movieGroup;
      existing.affectedFiles = preview.affectedFiles;
      existing.files = preview.files;
      existing.updatedAt = now;
      this.touch(now);
      return this.clonePreview(existing);
    }
    const item: MaintenanceSessionPreview = {
      ...preview,
      id: randomUUID(),
      sessionId: this.id,
      presetId: this.presetId,
      createdAt: now,
      updatedAt: now,
    };
    this.previews.set(item.id, item);
    this.touch(now);
    return this.clonePreview(item);
  }

  preview(previewId: string): MaintenanceSessionPreview | undefined {
    const preview = this.previews.get(previewId);
    return preview ? this.clonePreview(preview) : undefined;
  }

  updateDraft(
    previewId: string,
    fieldSelections?: Record<string, "old" | "new">,
    paths?: Pick<MaintenanceSessionPreview, "pathDiff" | "affectedFiles">,
  ): void {
    const preview = this.previews.get(previewId);
    if (!preview || (preview.status !== "ready" && preview.status !== "blocked")) {
      throw new Error("维护预览不存在或已提交");
    }
    if (fieldSelections) this.draft.fieldSelections[previewId] = { ...fieldSelections };
    if (paths) {
      preview.pathDiff = paths.pathDiff;
      preview.affectedFiles = paths.affectedFiles;
      preview.updatedAt = new Date();
    }
    this.touch();
  }

  markApplyProcessing(item: MaintenanceBatchItem): {
    item: MaintenanceBatchItem;
    preview?: MaintenanceSessionPreview;
  } {
    this.assertActive(["running"]);
    const current = this.currentBatch?.items.get(item.selection.previewId);
    if (!current || current.id !== item.id || current.status !== "pending") {
      throw new InactiveMaintenanceSessionError(`Inactive maintenance item for ${this.id}`);
    }
    current.status = "processing";
    current.error = null;
    current.updatedAt = new Date();
    this.touch();
    return { item: this.cloneBatchItem(current), preview: this.preview(item.selection.previewId) };
  }

  commitItem(item: MaintenanceBatchItem, result: MaintenanceApplyItemResult): boolean {
    this.assertActive(["running", "paused", "stopping"]);
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

  skipOutstanding(error: string): boolean {
    this.assertActive(["running", "paused", "stopping"]);
    let changed = false;
    for (const item of this.currentBatch?.items.values() ?? []) {
      if (TERMINAL_ITEM_STATUSES.has(item.status)) continue;
      changed = this.commitItem(item, { status: "skipped", error }) || changed;
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

  editablePreviews(): MaintenanceSessionPreview[] {
    return [...this.previews.values()]
      .filter((preview) => preview.status === "ready" || preview.status === "blocked")
      .sort((left, right) =>
        `${left.rootId}\0${left.relativePath}`.localeCompare(`${right.rootId}\0${right.relativePath}`, "zh-CN"),
      )
      .map((preview) => this.clonePreview(preview));
  }

  activePreviews(): MaintenanceSessionPreview[] {
    return [...this.previews.values()]
      .filter(
        (preview) =>
          preview.status === "ready" ||
          preview.status === "blocked" ||
          preview.status === "pending" ||
          preview.status === "processing",
      )
      .sort((left, right) =>
        `${left.rootId}\0${left.relativePath}`.localeCompare(`${right.rootId}\0${right.relativePath}`, "zh-CN"),
      )
      .map((preview) => this.clonePreview(preview));
  }

  applyLogs(): MaintenanceSessionApplyLog[] {
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
                sessionId: this.id,
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

  progress(): MaintenanceSessionProgress & { totalEntries: number } {
    if (this.phaseValue === "preview") {
      const previews = [...this.previews.values()];
      const completed = previews.filter((preview) => preview.status === "ready" || preview.status === "blocked");
      return {
        totalEntries: this.refsValue.length,
        completedEntries: completed.length,
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

  statusSnapshot(): MaintenanceSessionSnapshot {
    return {
      id: this.id,
      rootId: this.rootId,
      status: this.statusValue,
      ...this.progress(),
      totalEntries: this.manifestFixed ? this.progress().totalEntries : null,
      createdAt: new Date(this.timestamps.createdAt),
      updatedAt: new Date(this.timestamps.updatedAt),
      startedAt: this.timestamps.startedAt ? new Date(this.timestamps.startedAt) : null,
      completedAt: this.timestamps.completedAt ? new Date(this.timestamps.completedAt) : null,
      error: this.errorValue,
    };
  }

  snapshot(): MaintenanceActiveSessionSnapshot {
    return {
      directoryScope: this.directoryScope,
      discovery: this.discoveryValue ? structuredClone(this.discoveryValue) : undefined,
      manifestFixed: this.manifestFixed,
      id: this.id,
      rootId: this.rootId,
      outputRootId: this.outputRootId,
      outputRelativeDirectory: this.outputRelativeDirectory,
      presetId: this.presetId,
      phase: this.phaseValue,
      status: this.statusValue,
      refs: this.refsValue.map((ref) => ({ ...ref })),
      ...this.progress(),
      totalEntries: this.manifestFixed ? this.progress().totalEntries : null,
      timestamps: {
        createdAt: new Date(this.timestamps.createdAt),
        updatedAt: new Date(this.timestamps.updatedAt),
        startedAt: this.timestamps.startedAt ? new Date(this.timestamps.startedAt) : null,
        completedAt: this.timestamps.completedAt ? new Date(this.timestamps.completedAt) : null,
      },
      error: this.errorValue,
      previews: this.activePreviews(),
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

  private clonePreview(preview: MaintenanceSessionPreview): MaintenanceSessionPreview {
    return structuredClone(preview);
  }

  private cloneBatchItem(item: MaintenanceBatchItem): MaintenanceBatchItem {
    return structuredClone(item);
  }
}
