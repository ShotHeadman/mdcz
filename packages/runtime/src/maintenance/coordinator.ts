import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { type MediaRoot, toRootRelativePath } from "@mdcz/media-store";
import { buildMaintenanceApplyCommit } from "@mdcz/shared/maintenanceCommit";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyBatch,
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenanceExecutionState,
  MaintenancePreviewBatch,
  MaintenanceSessionDraft,
  MaintenanceTaskApplyItemStatus,
  MaintenanceTaskApplyLog,
  MaintenanceTaskApplyQueueItem,
  MaintenanceTaskEvent,
  MaintenanceTaskPreview,
  MaintenanceTaskProgress,
  MaintenanceTaskRef,
  MaintenanceTaskSnapshot,
  MaintenanceTaskStatus,
} from "@mdcz/shared/maintenanceTasks";
import type { LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";
import { isAbortError } from "../scrape/utils/abort";
import { TaskExecutor } from "../tasks";
import {
  type MaintenanceCoordinatorEvent,
  type MaintenanceCoordinatorEventSink,
  type MaintenanceLibraryPort,
  type MaintenanceRootPort,
  type MaintenanceRunHandle,
  noopMaintenanceCoordinatorEventSink,
} from "./coordinatorContracts";
import type { MaintenanceRuntime, MaintenanceRuntimePreviewItem } from "./MaintenanceRuntime";

const PREVIEW_ALL_FAILED = "维护预览全部失败";
const APPLY_FAILED = "维护应用失败";
const STOPPED = "维护已停止";
const STOPPED_ITEM = "维护已停止，项目未执行";
const INTERRUPTED = "维护因服务关闭而中断，请重新预览后执行";
const OWNERSHIP_CHANGED = "Maintenance execution ownership changed";

const ACTIVE_STATUSES: readonly MaintenanceTaskStatus[] = ["queued", "running", "paused", "stopping"];
const TERMINAL_ITEM_STATUSES = new Set<MaintenanceTaskApplyItemStatus>(["success", "failed", "skipped"]);

type MaintenanceSessionTimestamps = {
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

type MaintenanceCurrentBatchItem = {
  id: string;
  selection: MaintenanceApplySelection;
  status: MaintenanceTaskApplyItemStatus;
  error: string | null;
  result?: MaintenanceApplyItemResult;
  createdAt: Date;
  updatedAt: Date;
};

type MaintenanceCurrentBatch = {
  id: string;
  items: Map<string, MaintenanceCurrentBatchItem>;
};
type MaintenanceApplyExecutionResult = {
  result: MaintenanceApplyItemResult;
  libraryCommit?: Parameters<MaintenanceLibraryPort["commitRefresh"]>[0];
};

type MaintenanceSessionState = {
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

type ExecutorControl = {
  pause(): void;
  stop(): void;
  waitForIdle(): Promise<void>;
};

type ActiveExecution = {
  sessionId: string;
  generation: number;
  phase: "preview" | "apply";
  executor: ExecutorControl;
};

interface MaintenanceTaskCoordinatorDependencies {
  roots: MaintenanceRootPort;
  runtime: MaintenanceRuntime;
  library: MaintenanceLibraryPort;
  events?: MaintenanceCoordinatorEventSink;
  concurrency: 1;
}

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const copySelection = (selection: MaintenanceApplySelection): MaintenanceApplySelection => ({
  previewId: selection.previewId,
  ...(selection.fieldSelections ? { fieldSelections: { ...selection.fieldSelections } } : {}),
});

export class MaintenanceTaskCoordinator {
  private readonly roots: MaintenanceRootPort;
  private readonly runtime: MaintenanceRuntime;
  private readonly library: MaintenanceLibraryPort;
  private readonly events: MaintenanceCoordinatorEventSink;
  private session: MaintenanceSessionState | null = null;
  private active: ActiveExecution | null = null;
  private executionPromise: Promise<void> | null = null;
  private readonly changeWaiters = new Map<string, Set<() => void>>();
  private closing = false;

  constructor(deps: MaintenanceTaskCoordinatorDependencies) {
    if (deps.concurrency !== 1) throw new Error("Maintenance coordinator concurrency must be 1");
    this.roots = deps.roots;
    this.runtime = deps.runtime;
    this.library = deps.library;
    this.events = deps.events ?? noopMaintenanceCoordinatorEventSink;
  }

  async startPreview(input: {
    rootId: string;
    presetId: MaintenancePresetId;
    refs?: readonly MaintenanceTaskRef[];
  }): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    this.assertOpen();
    const refs = [...(input.refs ?? [])];
    this.assertUniqueRefs(refs);
    await this.roots.getActiveRoot(input.rootId);
    if (this.session && ACTIVE_STATUSES.includes(this.session.status)) {
      throw new Error("已有活动的维护会话，请先完成或停止当前会话");
    }

    const now = new Date();
    const generation = (this.session?.generation ?? 0) + 1;
    if (this.session) this.session.generation = generation;
    const progress = this.emptyProgress(refs.length);
    this.session = {
      id: randomUUID(),
      rootId: input.rootId,
      presetId: input.presetId,
      phase: "preview",
      status: "queued",
      generation,
      refs,
      progress,
      timestamps: { createdAt: now, updatedAt: now, startedAt: null, completedAt: null },
      error: null,
      previews: new Map(),
      currentBatch: null,
      draft: { fieldSelections: {}, imageSelections: {} },
      events: [],
    };
    const sessionId = this.session.id;
    await this.publishTaskEvent(this.session, "queued", `Maintenance task queued. Preset: ${input.presetId}`);
    await this.publishLog(this.session, "preset", `Maintenance preset: ${input.presetId}`);
    await this.startCurrentPhase(sessionId, generation);
    return {
      task: this.snapshotTask(this.requireSession(sessionId)),
      completion: this.waitForPreview(sessionId),
    };
  }

  async readPreview(taskId: string): Promise<MaintenancePreviewBatch> {
    const session = this.requireSession(taskId);
    return { task: this.snapshotTask(session), items: this.listEditablePreviews(session) };
  }

  async waitForPreview(taskId: string): Promise<MaintenancePreviewBatch> {
    for (;;) {
      const batch = await this.readPreview(taskId);
      if (batch.task.status === "completed") return batch;
      if (batch.task.status === "failed") {
        if (batch.task.error === PREVIEW_ALL_FAILED) return batch;
        throw new Error(batch.task.error ?? "维护预览失败");
      }
      await this.waitForChange(taskId);
    }
  }

  async beginApply(input: {
    taskId: string;
    selections: readonly MaintenanceApplySelection[];
  }): Promise<MaintenanceRunHandle<MaintenanceApplyBatch>> {
    this.assertOpen();
    if (input.selections.length === 0) throw new Error("请选择要应用的维护预览");
    const previewIds = input.selections.map((selection) => selection.previewId);
    if (new Set(previewIds).size !== previewIds.length) throw new Error("维护预览 ID 重复");

    const session = this.requireSession(input.taskId);
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
    session.generation += 1;
    const generation = session.generation;
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
    session.phase = "apply";
    session.status = "queued";
    session.currentBatch = { id: batchId, items };
    session.progress = this.emptyProgress(items.size);
    session.error = null;
    session.timestamps = {
      ...session.timestamps,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    await this.publishTaskEvent(session, "queued", `Maintenance apply queued. Items: ${items.size}`);
    await this.startCurrentPhase(session.id, generation);
    const selectedIds = new Set(previewIds);
    return {
      task: this.snapshotTask(session),
      completion: this.waitForApply(session.id, batchId, selectedIds),
    };
  }

  async pause(taskId: string): Promise<MaintenanceTaskSnapshot> {
    const session = this.requireSession(taskId);
    if (session.status !== "queued" && session.status !== "running") return this.snapshotTask(session);
    session.status = "paused";
    session.error = null;
    this.touch(session);
    await this.publishTaskEvent(session, "paused", "Maintenance task paused");
    const active = this.activeFor(session.id, session.generation);
    active?.executor.pause();
    await this.awaitCurrentExecution();
    return this.snapshotTask(this.requireSession(taskId));
  }

  async resume(taskId: string): Promise<MaintenanceTaskSnapshot> {
    const session = this.requireSession(taskId);
    if (session.status !== "paused") return this.snapshotTask(session);
    await this.awaitCurrentExecution();
    const current = this.requireSession(taskId);
    if (current.status !== "paused") return this.snapshotTask(current);
    await this.startCurrentPhase(current.id, current.generation, "Maintenance task resumed");
    return this.snapshotTask(current);
  }

  async stop(taskId: string): Promise<MaintenanceTaskSnapshot> {
    const session = this.requireSession(taskId);
    if (session.status === "completed" || session.status === "failed") return this.snapshotTask(session);

    session.generation += 1;
    const generation = session.generation;
    session.status = "stopping";
    session.error = STOPPED;
    this.touch(session);
    await this.publishTaskEvent(session, "stopping", "Stopping maintenance task");
    this.active?.executor.stop();
    await this.awaitCurrentExecution();

    const current = this.requireSession(taskId);
    if (current.generation !== generation) return this.snapshotTask(current);
    if (current.phase === "apply") await this.skipOutstandingApplyItems(current, generation, STOPPED_ITEM);
    await this.finishSession(current, generation, "failed", STOPPED);
    return this.snapshotTask(current);
  }

  async getTask(taskId: string): Promise<MaintenanceTaskSnapshot> {
    return this.snapshotTask(this.requireSession(taskId));
  }

  async listTasks(): Promise<MaintenanceTaskSnapshot[]> {
    return this.session ? [this.snapshotTask(this.session)] : [];
  }

  async listEvents(taskId: string): Promise<MaintenanceTaskEvent[]> {
    return [...this.requireSession(taskId).events];
  }

  async listApplyLogs(taskId: string): Promise<MaintenanceTaskApplyLog[]> {
    return this.deriveApplyLogs(this.requireSession(taskId));
  }

  async getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null> {
    const session = this.session;
    if (!session) return null;
    const applyItems = this.deriveApplyItems(session);
    const recentItems = this.deriveRecentBatchItems(session);
    return {
      task: this.snapshotTask(session),
      execution: this.snapshotExecution(session),
      previews: this.listEditablePreviews(session),
      applyItems,
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

  async updateDraft(input: {
    taskId: string;
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
    imageSelections?: Record<string, string>;
  }): Promise<MaintenanceActiveSessionSnapshot> {
    const session = this.requireSession(input.taskId);
    const preview = session.previews.get(input.previewId);
    if (!preview || (preview.status !== "ready" && preview.status !== "blocked")) {
      throw new Error("维护预览不存在或已提交");
    }
    if (input.fieldSelections) session.draft.fieldSelections[input.previewId] = { ...input.fieldSelections };
    if (input.imageSelections) session.draft.imageSelections[input.previewId] = { ...input.imageSelections };
    this.touch(session);
    return (await this.getActiveSession()) as MaintenanceActiveSessionSnapshot;
  }

  async discardSession(taskId?: string): Promise<void> {
    if (!this.session) return;
    if (taskId && this.session.id !== taskId) throw new Error("维护会话已变化");
    if (ACTIVE_STATUSES.includes(this.session.status)) throw new Error("维护会话仍在运行，请先停止后再返回设置");
    const discardedId = this.session.id;
    this.session.generation += 1;
    this.session = null;
    this.notify(discardedId);
  }

  async waitForIdle(): Promise<void> {
    await this.awaitCurrentExecution();
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const session = this.session;
    if (!session || !ACTIVE_STATUSES.includes(session.status)) {
      if (session) session.generation += 1;
      return;
    }

    session.generation += 1;
    const generation = session.generation;
    session.status = "stopping";
    session.error = INTERRUPTED;
    this.touch(session);
    this.active?.executor.stop();
    await this.awaitCurrentExecution();
    if (!this.isCurrent(session.id, generation)) return;
    if (session.phase === "apply") await this.skipOutstandingApplyItems(session, generation, INTERRUPTED);
    await this.finishSession(session, generation, "failed", INTERRUPTED);
  }

  private async startCurrentPhase(sessionId: string, generation: number, message?: string): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["queued", "paused"]);
    if (this.executionPromise) throw new Error("Maintenance coordinator already has an active executor");
    const now = new Date();
    session.status = "running";
    session.error = null;
    session.timestamps = {
      ...session.timestamps,
      startedAt: session.timestamps.startedAt ?? now,
      completedAt: null,
      updatedAt: now,
    };
    await this.publishTaskEvent(session, "running", message ?? `Starting maintenance ${session.phase}`);

    const run =
      session.phase === "preview" ? this.runPreview(sessionId, generation) : this.runApply(sessionId, generation);
    let tracked: Promise<void>;
    tracked = run.finally(() => {
      if (this.executionPromise === tracked) this.executionPromise = null;
      this.notify(sessionId);
    });
    this.executionPromise = tracked;
    void tracked.catch(() => undefined);
  }

  private async waitForApply(
    taskId: string,
    batchId: string,
    selectedIds: ReadonlySet<string>,
  ): Promise<MaintenanceApplyBatch> {
    for (;;) {
      const session = this.requireSession(taskId);
      if (session.status === "completed" || session.status === "failed") {
        if (session.currentBatch?.id !== batchId) throw new Error("维护批次已变化");
        return {
          task: this.snapshotTask(session),
          batchId,
          items: this.listEditablePreviews(session),
          applied: this.deriveApplyLogs(session).filter((log) => selectedIds.has(log.previewId)),
        };
      }
      await this.waitForChange(taskId);
    }
  }

  private async runPreview(sessionId: string, generation: number): Promise<void> {
    const scanController = new AbortController();
    this.active = {
      sessionId,
      generation,
      phase: "preview",
      executor: {
        pause: () => undefined,
        stop: () => scanController.abort(),
        waitForIdle: async () => undefined,
      },
    };
    try {
      const initial = this.assertCurrent(sessionId, generation, ["running"]);
      const root = await this.roots.getActiveRoot(initial.rootId);
      const persistedRefs = [...initial.refs];
      const entries =
        persistedRefs.length > 0
          ? await this.scanExactRefs(root, persistedRefs, scanController.signal)
          : await this.runtime
              .scan({ root, signal: scanController.signal })
              .then((discovered) =>
                [...discovered].sort((left, right) =>
                  this.relativePath(root, left).localeCompare(this.relativePath(root, right), "zh-CN"),
                ),
              );

      const afterScan = this.assertCurrent(sessionId, generation, ["running", "paused"]);
      if (persistedRefs.length === 0) {
        const refs = entries.map((entry) => ({ relativePath: this.relativePath(root, entry) }));
        this.assertUniqueRefs(refs);
        afterScan.refs = refs;
        afterScan.progress = this.emptyProgress(refs.length);
        this.touch(afterScan);
      }
      if (afterScan.status === "paused") return;

      const committedPaths = new Set([...afterScan.previews.values()].map((preview) => preview.relativePath));
      const pending = entries.filter((entry) => !committedPaths.has(this.relativePath(root, entry)));
      const executor = new TaskExecutor<
        LocalScanEntry,
        {
          entry: LocalScanEntry;
          item: MaintenanceRuntimePreviewItem;
          librarySource: Awaited<ReturnType<MaintenanceLibraryPort["resolveSource"]>>;
        }
      >({
        concurrency: 1,
        gate: {
          beforeItem: async () => {
            this.assertCurrent(sessionId, generation, ["running"]);
          },
          beforeResult: async () => {
            this.assertCurrent(sessionId, generation, ["running", "paused"]);
          },
        },
        runItem: async (entry, context) => {
          try {
            const current = this.assertCurrent(sessionId, generation, ["running"]);
            const [item] = await this.runtime.previewEntries({
              root,
              presetId: current.presetId,
              entries: [entry],
              signal: context.signal,
            });
            if (!item) throw new Error("维护预览未返回结果");
            const librarySource = await this.library.resolveSource(entry.fileInfo.filePath);
            return { entry, item, librarySource };
          } catch (error) {
            if (isAbortError(error) || context.signal.aborted) throw error;
            return {
              entry,
              item: {
                entry,
                rootId: root.id,
                relativePath: this.relativePath(root, entry),
                status: "blocked",
                error: toErrorMessage(error),
                fieldDiffs: [],
                unchangedFieldDiffs: [],
                pathDiff: null,
                proposedCrawlerData: null,
              },
              librarySource: null,
            };
          }
        },
        applyResult: async (_entry, result) => {
          const current = this.assertCurrent(sessionId, generation, ["running", "paused"]);
          const preview = this.toPreview(current, result.item, result.librarySource);
          const duplicate = [...current.previews.values()].find(
            (existing) => existing.relativePath === preview.relativePath && existing.id !== preview.id,
          );
          if (duplicate) throw new Error(`维护预览路径重复：${preview.relativePath}`);
          current.previews.set(preview.id, preview);
          current.progress = {
            totalEntries: current.progress.totalEntries,
            completedEntries: current.progress.completedEntries + 1,
            successCount: current.progress.successCount + (preview.status === "ready" ? 1 : 0),
            failedCount: current.progress.failedCount + (preview.status === "blocked" ? 1 : 0),
          };
          this.touch(current);
          await this.publish({ kind: "preview-item", taskId: sessionId, preview, entry: result.entry });
          await this.publish({
            kind: "progress",
            taskId: sessionId,
            phase: "preview",
            progress: { ...current.progress },
            message: preview.relativePath,
          });
        },
      });
      this.active = { sessionId, generation, phase: "preview", executor };
      const summary = await executor.execute(pending, generation);
      if (summary.outcome === "paused" || summary.outcome === "stopped") return;
      const current = this.assertCurrent(sessionId, generation, ["running"]);
      const allBlocked =
        current.progress.totalEntries > 0 &&
        current.progress.successCount === 0 &&
        current.progress.failedCount >= current.progress.totalEntries;
      await this.finishSession(
        current,
        generation,
        allBlocked ? "failed" : "completed",
        allBlocked ? PREVIEW_ALL_FAILED : null,
      );
    } catch (error) {
      if (!this.isCurrent(sessionId, generation) || this.closing) return;
      const current = this.requireSession(sessionId);
      if (current.status === "paused") return;
      if (isAbortError(error) || current.status === "stopping" || toErrorMessage(error) === OWNERSHIP_CHANGED) return;
      await this.failSession(current, generation, toErrorMessage(error));
    } finally {
      if (this.active?.sessionId === sessionId && this.active.generation === generation) this.active = null;
      this.notify(sessionId);
    }
  }

  private async runApply(sessionId: string, generation: number): Promise<void> {
    try {
      const initial = this.assertCurrent(sessionId, generation, ["running"]);
      const root = await this.roots.getActiveRoot(initial.rootId);
      const pending = this.pendingBatchItems(initial);
      const executor = new TaskExecutor<MaintenanceCurrentBatchItem, MaintenanceApplyExecutionResult>({
        concurrency: 1,
        gate: {
          beforeItem: async () => {
            this.assertCurrent(sessionId, generation, ["running"]);
          },
          beforeResult: async () => {
            this.assertCurrent(sessionId, generation, ["running", "paused"]);
          },
        },
        runItem: async (item, context) => {
          const current = this.assertCurrent(sessionId, generation, ["running"]);
          const batchItem = current.currentBatch?.items.get(item.selection.previewId);
          if (!batchItem || batchItem.id !== item.id || batchItem.status !== "pending") {
            throw new Error(OWNERSHIP_CHANGED);
          }
          batchItem.status = "processing";
          batchItem.error = null;
          batchItem.updatedAt = new Date();
          this.touch(current);
          const preview = current.previews.get(item.selection.previewId);
          if (!preview) return { result: { status: "failed", error: "维护预览不存在" } };
          if (preview.status === "blocked") {
            return { result: { status: "skipped", error: preview.error ?? "维护预览不可应用" } };
          }
          try {
            const [entry] = await this.scanExactRefs(root, [{ relativePath: preview.relativePath }], context.signal);
            if (!entry) {
              return { result: { status: "failed", error: `维护文件不存在：${preview.relativePath}` } };
            }
            const committed = buildMaintenanceApplyCommit(entry, preview, item.selection.fieldSelections);
            const sourceAbsolutePath = preview.entry?.fileInfo.filePath ?? entry.fileInfo.filePath;
            const targetAbsolutePath = preview.pathDiff?.targetVideoPath ?? sourceAbsolutePath;
            await this.library.preflightRefresh({
              librarySource: preview.librarySource,
              sourceAbsolutePath,
              targetAbsolutePath,
            });
            const latest = this.assertCurrent(sessionId, generation, ["running", "paused"]);
            const applied = await this.runtime.applyEntry({
              root,
              presetId: latest.presetId,
              entry,
              committed,
              progress: {
                fileIndex: Math.min(latest.progress.totalEntries, latest.progress.completedEntries + 1),
                totalFiles: latest.progress.totalEntries,
              },
              signal: context.signal,
            });
            if (applied.status === "failed") return { result: { status: "failed", error: applied.error } };
            const outputRelativePath = applied.outputRelativePath || preview.relativePath;
            let file: Awaited<ReturnType<typeof stat>>;
            try {
              file = await stat(applied.entry.fileInfo.filePath);
            } catch (error) {
              return {
                result: {
                  status: "failed",
                  error: `文件操作已完成，但媒体库提交失败：${toErrorMessage(error)}。请重新扫描并预览，以磁盘实际状态重新协调。`,
                },
              };
            }
            const crawlerData = applied.crawlerData ?? applied.entry.crawlerData ?? committed.crawlerData;
            return {
              result: {
                status: "success",
                entry: applied.entry,
                crawlerData: applied.crawlerData ?? committed.crawlerData,
                fieldDiffs: applied.fieldDiffs,
                unchangedFieldDiffs: applied.unchangedFieldDiffs,
                pathDiff: applied.pathDiff,
                outputRelativePath,
                outputSize: file.size,
                outputModifiedAt: file.mtime,
              },
              libraryCommit: {
                librarySource: preview.librarySource,
                sourceAbsolutePath,
                targetAbsolutePath: applied.entry.fileInfo.filePath,
                size: file.size,
                modifiedAt: file.mtime,
                crawlerData,
                fallbackNumber: applied.entry.fileInfo.number,
                assets: applied.entry.assets,
                refreshedAt: new Date(),
              },
            };
          } catch (error) {
            return {
              result: {
                status: isAbortError(error) || context.signal.aborted ? "skipped" : "failed",
                error: isAbortError(error) || context.signal.aborted ? STOPPED_ITEM : toErrorMessage(error),
              },
            };
          }
        },
        applyResult: async (item, executionResult) => {
          let result = executionResult.result;
          if (executionResult.libraryCommit) {
            try {
              this.assertCurrent(sessionId, generation, ["running", "paused"]);
              await this.library.commitRefresh(executionResult.libraryCommit);
            } catch (error) {
              if (!this.isCurrent(sessionId, generation)) throw error;
              result = {
                status: "failed",
                error: `文件操作已完成，但媒体库提交失败：${toErrorMessage(error)}。请重新扫描并预览，以磁盘实际状态重新协调。`,
              };
            }
          }
          await this.commitApplyItem(sessionId, generation, item, result);
        },
      });
      this.active = { sessionId, generation, phase: "apply", executor };
      const summary = await executor.execute(pending, generation);
      if (summary.outcome === "paused" || summary.outcome === "stopped") return;
      const current = this.assertCurrent(sessionId, generation, ["running"]);
      const failedAll =
        current.progress.totalEntries > 0 &&
        current.progress.successCount === 0 &&
        current.progress.failedCount >= current.progress.totalEntries;
      await this.finishSession(
        current,
        generation,
        failedAll ? "failed" : "completed",
        failedAll ? APPLY_FAILED : null,
      );
    } catch (error) {
      if (!this.isCurrent(sessionId, generation) || this.closing) return;
      const current = this.requireSession(sessionId);
      if (current.status === "paused") return;
      if (isAbortError(error) || current.status === "stopping" || toErrorMessage(error) === OWNERSHIP_CHANGED) return;
      const message = toErrorMessage(error);
      await this.skipOutstandingApplyItems(current, generation, message);
      await this.failSession(current, generation, message);
    } finally {
      if (this.active?.sessionId === sessionId && this.active.generation === generation) this.active = null;
      this.notify(sessionId);
    }
  }

  private async commitApplyItem(
    sessionId: string,
    generation: number,
    item: MaintenanceCurrentBatchItem,
    result: MaintenanceApplyItemResult,
  ): Promise<MaintenanceTaskApplyLog | null> {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused", "stopping"]);
    const current = session.currentBatch?.items.get(item.selection.previewId);
    if (!current || current.id !== item.id || TERMINAL_ITEM_STATUSES.has(current.status)) return null;
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
    const log = this.toApplyLog(session, current, preview);
    await this.publish({ kind: "apply-item", taskId: sessionId, log, result });
    await this.publish({
      kind: "progress",
      taskId: sessionId,
      phase: "apply",
      progress: { ...session.progress },
      message: log.relativePath,
    });
    return log;
  }

  private async skipOutstandingApplyItems(
    session: MaintenanceSessionState,
    generation: number,
    error: string,
  ): Promise<void> {
    for (const item of this.pendingOrProcessingBatchItems(session)) {
      await this.commitApplyItem(session.id, generation, item, { status: "skipped", error });
    }
  }

  private async finishSession(
    session: MaintenanceSessionState,
    generation: number,
    status: "completed" | "failed",
    error: string | null,
  ): Promise<void> {
    this.assertCurrent(session.id, generation, ["running", "stopping"]);
    const now = new Date();
    session.status = status;
    session.error = error;
    session.timestamps = { ...session.timestamps, completedAt: now, updatedAt: now };
    const message =
      session.phase === "preview"
        ? status === "failed"
          ? (error ?? "维护预览失败")
          : `Maintenance preview completed. Ready: ${session.progress.successCount}, Blocked: ${session.progress.failedCount}`
        : status === "failed"
          ? (error ?? APPLY_FAILED)
          : `Maintenance completed. Succeeded: ${session.progress.successCount}, Failed: ${session.progress.failedCount}`;
    await this.publishTaskEvent(session, status, message);
    if (status === "failed" && error) await this.publish({ kind: "task-failed", taskId: session.id, error });
  }

  private async failSession(session: MaintenanceSessionState, generation: number, error: string): Promise<void> {
    if (!this.isCurrent(session.id, generation) || !ACTIVE_STATUSES.includes(session.status)) return;
    await this.finishSession(session, generation, "failed", error);
  }

  private async scanExactRefs(
    root: MediaRoot,
    refs: readonly MaintenanceTaskRef[],
    signal?: AbortSignal,
  ): Promise<LocalScanEntry[]> {
    this.assertUniqueRefs(refs);
    const entries = await this.runtime.scanRefs({ root, refs: [...refs], signal });
    const byPath = new Map<string, LocalScanEntry>();
    for (const entry of entries) {
      const relativePath = this.relativePath(root, entry);
      if (byPath.has(relativePath)) throw new Error(`维护扫描结果路径重复：${relativePath}`);
      byPath.set(relativePath, entry);
    }
    if (byPath.size !== refs.length || refs.some((ref) => !byPath.has(ref.relativePath))) {
      throw new Error("维护扫描结果与请求文件不一致");
    }
    return refs.map((ref) => byPath.get(ref.relativePath) as LocalScanEntry);
  }

  private relativePath(root: MediaRoot, entry: LocalScanEntry): string {
    if (entry.rootRef?.rootId === root.id) return entry.rootRef.relativePath;
    return toRootRelativePath(root, entry.fileInfo.filePath);
  }

  private toPreview(
    session: MaintenanceSessionState,
    item: MaintenanceRuntimePreviewItem,
    librarySource: Awaited<ReturnType<MaintenanceLibraryPort["resolveSource"]>>,
  ): MaintenanceTaskPreview {
    const now = new Date();
    return {
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
  }

  private snapshotTask(session: MaintenanceSessionState): MaintenanceTaskSnapshot {
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

  private snapshotExecution(session: MaintenanceSessionState): MaintenanceExecutionState {
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

  private listEditablePreviews(session: MaintenanceSessionState): MaintenanceTaskPreview[] {
    return [...session.previews.values()]
      .filter((preview) => preview.status === "ready" || preview.status === "blocked")
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
  }

  private deriveApplyItems(session: MaintenanceSessionState): MaintenanceTaskApplyQueueItem[] {
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

  private deriveApplyLogs(session: MaintenanceSessionState): MaintenanceTaskApplyLog[] {
    if (!session.currentBatch) return [];
    return [...session.currentBatch.items.values()]
      .filter((item) => TERMINAL_ITEM_STATUSES.has(item.status))
      .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
      .flatMap((item) => {
        const preview = session.previews.get(item.selection.previewId);
        return preview ? [this.toApplyLog(session, item, preview)] : [];
      });
  }

  private deriveRecentBatchItems(
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
        return preview ? [{ log: this.toApplyLog(session, item, preview), result: item.result }] : [];
      });
  }

  private toApplyLog(
    session: MaintenanceSessionState,
    item: MaintenanceCurrentBatchItem,
    preview: MaintenanceTaskPreview,
  ): MaintenanceTaskApplyLog {
    if (!session.currentBatch || !TERMINAL_ITEM_STATUSES.has(item.status)) {
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

  private pendingBatchItems(session: MaintenanceSessionState): MaintenanceCurrentBatchItem[] {
    return session.currentBatch
      ? [...session.currentBatch.items.values()]
          .filter((item) => item.status === "pending")
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      : [];
  }

  private pendingOrProcessingBatchItems(session: MaintenanceSessionState): MaintenanceCurrentBatchItem[] {
    return session.currentBatch
      ? [...session.currentBatch.items.values()].filter(
          (item) => item.status === "pending" || item.status === "processing",
        )
      : [];
  }

  private emptyProgress(totalEntries: number): MaintenanceTaskProgress {
    return { totalEntries, completedEntries: 0, successCount: 0, failedCount: 0 };
  }

  private touch(session: MaintenanceSessionState, now = new Date()): void {
    session.timestamps.updatedAt = now;
  }

  private activeFor(sessionId: string, generation: number): ActiveExecution | null {
    return this.active?.sessionId === sessionId && this.active.generation === generation ? this.active : null;
  }

  private isCurrent(sessionId: string, generation: number): boolean {
    return Boolean(this.session && this.session.id === sessionId && this.session.generation === generation);
  }

  private assertCurrent(
    sessionId: string,
    generation: number,
    statuses?: readonly MaintenanceTaskStatus[],
  ): MaintenanceSessionState {
    const session = this.session;
    if (!session || session.id !== sessionId || session.generation !== generation) throw new Error(OWNERSHIP_CHANGED);
    if (statuses && !statuses.includes(session.status)) throw new Error(OWNERSHIP_CHANGED);
    return session;
  }

  private requireSession(taskId: string): MaintenanceSessionState {
    if (!this.session || this.session.id !== taskId) throw new Error(`Maintenance task not found: ${taskId}`);
    return this.session;
  }

  private assertUniqueRefs(refs: readonly MaintenanceTaskRef[]): void {
    const seen = new Set<string>();
    for (const ref of refs) {
      if (!ref.relativePath.trim()) throw new Error("维护文件相对路径不能为空");
      if (seen.has(ref.relativePath)) throw new Error(`维护文件路径重复：${ref.relativePath}`);
      seen.add(ref.relativePath);
    }
  }

  private async publishTaskEvent(session: MaintenanceSessionState, type: string, message: string): Promise<void> {
    const event = this.addEvent(session, type, message);
    await this.publish({ kind: "task-changed", task: this.snapshotTask(session) });
    await this.publish({ kind: "log", taskId: session.id, event });
  }

  private async publishLog(session: MaintenanceSessionState, type: string, message: string): Promise<void> {
    const event = this.addEvent(session, type, message);
    await this.publish({ kind: "log", taskId: session.id, event });
  }

  private addEvent(session: MaintenanceSessionState, type: string, message: string): MaintenanceTaskEvent {
    const event = { id: randomUUID(), taskId: session.id, type, message, createdAt: new Date() };
    session.events.push(event);
    return event;
  }

  private async publish(event: MaintenanceCoordinatorEvent): Promise<void> {
    await this.events.publish(event);
    this.notify("taskId" in event ? event.taskId : event.task.id);
  }

  private notify(taskId: string): void {
    const waiters = this.changeWaiters.get(taskId);
    if (!waiters) return;
    this.changeWaiters.delete(taskId);
    for (const waiter of waiters) waiter();
  }

  private async waitForChange(taskId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const waiters = this.changeWaiters.get(taskId) ?? new Set<() => void>();
      let timer: ReturnType<typeof setTimeout>;
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve();
      };
      waiters.add(done);
      this.changeWaiters.set(taskId, waiters);
      timer = setTimeout(done, 50);
    });
  }

  private async awaitCurrentExecution(): Promise<void> {
    for (;;) {
      const current = this.executionPromise;
      if (!current) return;
      await current.catch(() => undefined);
      if (this.executionPromise === current) return;
    }
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("Maintenance coordinator is closed");
  }
}
