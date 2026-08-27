import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { type MediaRoot, toRootRelativePath } from "@mdcz/media-store";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyBatch,
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenanceLibrarySource,
  MaintenancePreviewBatch,
  MaintenanceSessionDraft,
  MaintenanceTaskApplyItemStatus,
  MaintenanceTaskApplyLog,
  MaintenanceTaskEvent,
  MaintenanceTaskPreview,
  MaintenanceTaskProgress,
  MaintenanceTaskRef,
  MaintenanceTaskSnapshot,
  MaintenanceTaskStatus,
} from "@mdcz/shared/maintenanceTasks";
import type { CrawlerData, DiscoveredAssets, LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";
import type { PreparedPublicationPlan } from "../publication";
import { isAbortError } from "../scrape/utils/abort";
import { TaskExecutor } from "../tasks";
import { buildMaintenanceApplyData } from "./applyData";
import type { MaintenanceRuntime, MaintenanceRuntimePreviewItem } from "./MaintenanceRuntime";

export interface MaintenanceRootPort {
  getActiveRoot(rootId: string): Promise<MediaRoot>;
}

export interface MaintenanceLibraryPort {
  resolveSource(absolutePath: string): Promise<MaintenanceLibrarySource | null>;
  preflightRefresh(input: {
    librarySource?: MaintenanceLibrarySource;
    sourceAbsolutePath: string;
    targetAbsolutePath: string;
  }): Promise<void>;
  publishRefresh(input: {
    operationId: string;
    plan: PreparedPublicationPlan;
    refresh: {
      librarySource?: MaintenanceLibrarySource;
      sourceAbsolutePath: string;
      targetAbsolutePath: string;
      size: number;
      modifiedAt: Date;
      crawlerData?: CrawlerData;
      fallbackNumber: string;
      assets: DiscoveredAssets;
      refreshedAt: Date;
    };
  }): Promise<{ libraryItemId: string }>;
}

export type MaintenanceCoordinatorEvent =
  | { kind: "task-changed"; task: MaintenanceTaskSnapshot }
  | { kind: "log"; taskId: string; event: MaintenanceTaskEvent };

export interface MaintenanceRunHandle<TResult> {
  task: MaintenanceTaskSnapshot;
  completion: Promise<TResult>;
}

type CurrentBatchItem = {
  id: string;
  selection: MaintenanceApplySelection;
  status: MaintenanceTaskApplyItemStatus;
  error: string | null;
  result?: MaintenanceApplyItemResult;
  createdAt: Date;
  updatedAt: Date;
};

type Session = {
  id: string;
  rootId: string;
  presetId: MaintenancePresetId;
  phase: "preview" | "apply";
  status: MaintenanceTaskStatus;
  generation: number;
  refs: MaintenanceTaskRef[];
  timestamps: { createdAt: Date; updatedAt: Date; startedAt: Date | null; completedAt: Date | null };
  error: string | null;
  previews: Map<string, MaintenanceTaskPreview>;
  currentBatch: { id: string; items: Map<string, CurrentBatchItem> } | null;
  draft: MaintenanceSessionDraft;
  releasePaths: Array<() => void>;
};

type ActiveExecution = {
  sessionId: string;
  generation: number;
  executor: { pause(): void; stop(): void };
};

type PreviewExecutionResult = {
  entry: LocalScanEntry;
  item: MaintenanceRuntimePreviewItem;
  librarySource: MaintenanceLibrarySource | null;
};

type ApplyExecutionResult = {
  result: MaintenanceApplyItemResult;
  publication?: Parameters<MaintenanceLibraryPort["publishRefresh"]>[0];
};

const ACTIVE_STATUSES: readonly MaintenanceTaskStatus[] = ["queued", "running", "paused", "stopping"];
const TERMINAL_ITEM_STATUSES = new Set<MaintenanceTaskApplyItemStatus>(["success", "failed", "skipped"]);
const PREVIEW_ALL_FAILED = "维护预览全部失败";
const APPLY_FAILED = "维护应用失败";
const STOPPED = "维护已停止";
const STOPPED_ITEM = "维护已停止，项目未执行";
const INTERRUPTED = "维护因服务关闭而中断，请重新预览后执行";
const OWNERSHIP_CHANGED = "Maintenance execution ownership changed";

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const relativePath = (root: MediaRoot, entry: LocalScanEntry): string =>
  entry.rootRef?.rootId === root.id ? entry.rootRef.relativePath : toRootRelativePath(root, entry.fileInfo.filePath);

const assertUniqueRefs = (refs: readonly MaintenanceTaskRef[]): void => {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref.relativePath.trim()) throw new Error("维护文件相对路径不能为空");
    if (seen.has(ref.relativePath)) throw new Error(`维护文件路径重复：${ref.relativePath}`);
    seen.add(ref.relativePath);
  }
};

const scanRefs = async (
  runtime: MaintenanceRuntime,
  root: MediaRoot,
  refs: readonly MaintenanceTaskRef[],
  signal?: AbortSignal,
): Promise<LocalScanEntry[]> => {
  assertUniqueRefs(refs);
  const entries = await runtime.scanRefs({ root, refs: refs.map((ref) => ({ ...ref })), signal });
  const byPath = new Map<string, LocalScanEntry>();
  for (const entry of entries) {
    const path = relativePath(root, entry);
    if (byPath.has(path)) throw new Error(`维护扫描结果路径重复：${path}`);
    byPath.set(path, entry);
  }
  if (byPath.size !== refs.length || refs.some((ref) => !byPath.has(ref.relativePath))) {
    throw new Error("维护扫描结果与请求文件不一致");
  }
  return refs.map((ref) => byPath.get(ref.relativePath) as LocalScanEntry);
};

const libraryCommitFailure = (error: unknown): MaintenanceApplyItemResult => ({
  status: "failed",
  error: `文件操作已完成，但媒体库提交失败：${errorMessage(error)}。请重新扫描并预览，以磁盘实际状态重新协调。`,
});

export class MaintenanceTaskCoordinator {
  private session: Session | null = null;
  private active: ActiveExecution | null = null;
  private executionPromise: Promise<void> | null = null;
  private readonly changeWaiters = new Map<string, Set<() => void>>();
  private closing = false;

  constructor(
    private readonly deps: {
      roots: MaintenanceRootPort;
      runtime: MaintenanceRuntime;
      library: MaintenanceLibraryPort;
      events?: { publish(event: MaintenanceCoordinatorEvent): void | Promise<void> };
      concurrency: 1;
    },
  ) {
    if (deps.concurrency !== 1) throw new Error("Maintenance coordinator concurrency must be 1");
  }

  async startPreview(input: {
    rootId: string;
    presetId: MaintenancePresetId;
    refs?: readonly MaintenanceTaskRef[];
  }): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    this.assertOpen();
    const refs = [...(input.refs ?? [])];
    assertUniqueRefs(refs);
    await this.deps.roots.getActiveRoot(input.rootId);
    if (this.session && ACTIVE_STATUSES.includes(this.session.status)) {
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
      refs: refs.map((ref) => ({ ...ref })),
      timestamps: { createdAt: now, updatedAt: now, startedAt: null, completedAt: null },
      error: null,
      previews: new Map(),
      currentBatch: null,
      draft: { fieldSelections: {} },
      releasePaths: [],
    };
    await this.publishStatus(this.session, "queued", `Maintenance task queued. Preset: ${input.presetId}`);
    await this.publishLog(this.session, "preset", `Maintenance preset: ${input.presetId}`);
    await this.startCurrentPhase(this.session.id, generation);
    return { task: this.task(this.session), completion: this.waitForPreview(this.session.id) };
  }

  async readPreview(taskId: string): Promise<MaintenancePreviewBatch> {
    const session = this.require(taskId);
    return { task: this.task(session), items: this.editablePreviews(session) };
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
    const releasePaths: Array<() => void> = [];
    try {
      void previewIds;
    } catch (error) {
      for (const release of releasePaths) release();
      throw error;
    }
    session.releasePaths = releasePaths;
    const now = new Date();
    const batchId = randomUUID();
    const items = new Map<string, CurrentBatchItem>();
    for (const original of input.selections) {
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
      if (selection.fieldSelections)
        session.draft.fieldSelections[selection.previewId] = { ...selection.fieldSelections };
    }
    session.generation += 1;
    session.phase = "apply";
    session.status = "queued";
    session.currentBatch = { id: batchId, items };
    session.error = null;
    session.timestamps = { ...session.timestamps, updatedAt: now, startedAt: null, completedAt: null };
    await this.publishStatus(session, "queued", `Maintenance apply queued. Items: ${items.size}`);
    await this.startCurrentPhase(session.id, session.generation);
    return {
      task: this.task(session),
      completion: this.waitForApply(session.id, batchId, new Set(previewIds)),
    };
  }

  async pause(taskId: string): Promise<MaintenanceTaskSnapshot> {
    const session = this.require(taskId);
    if (session.status !== "queued" && session.status !== "running") return this.task(session);
    session.status = "paused";
    session.error = null;
    this.touch(session);
    await this.publishStatus(session, "paused", "Maintenance task paused");
    this.activeFor(session.id, session.generation)?.executor.pause();
    await this.awaitCurrentExecution();
    return this.task(this.require(taskId));
  }

  async resume(taskId: string): Promise<MaintenanceTaskSnapshot> {
    const session = this.require(taskId);
    if (session.status !== "paused") return this.task(session);
    await this.awaitCurrentExecution();
    const current = this.require(taskId);
    if (current.status !== "paused") return this.task(current);
    await this.startCurrentPhase(current.id, current.generation, "Maintenance task resumed");
    return this.task(current);
  }

  async stop(taskId: string): Promise<MaintenanceTaskSnapshot> {
    const current = this.require(taskId);
    if (current.status === "completed" || current.status === "failed") return this.task(current);
    current.generation += 1;
    current.status = "stopping";
    current.error = STOPPED;
    this.touch(current);
    const generation = current.generation;
    await this.publishStatus(current, "stopping", "Stopping maintenance task");
    this.active?.executor.stop();
    await this.awaitCurrentExecution();
    const latest = this.require(taskId);
    if (latest.generation !== generation) return this.task(latest);
    if (latest.phase === "apply") await this.skipOutstanding(latest.id, generation, STOPPED_ITEM);
    await this.finishSession(latest.id, generation, "failed", STOPPED);
    return this.task(latest);
  }

  async getTask(taskId: string): Promise<MaintenanceTaskSnapshot> {
    return this.task(this.require(taskId));
  }

  async listTasks(): Promise<MaintenanceTaskSnapshot[]> {
    return this.session ? [this.task(this.session)] : [];
  }

  async getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null> {
    return this.session ? this.snapshot(this.session) : null;
  }

  async updateDraft(input: {
    taskId: string;
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
  }): Promise<MaintenanceActiveSessionSnapshot> {
    const session = this.require(input.taskId);
    const preview = session.previews.get(input.previewId);
    if (!preview || (preview.status !== "ready" && preview.status !== "blocked")) {
      throw new Error("维护预览不存在或已提交");
    }
    if (input.fieldSelections) session.draft.fieldSelections[input.previewId] = { ...input.fieldSelections };
    this.touch(session);
    await this.publishChanged(session);
    return this.snapshot(session);
  }

  async discardSession(taskId?: string): Promise<void> {
    if (!this.session) return;
    if (taskId && this.session.id !== taskId) throw new Error("维护会话已变化");
    if (ACTIVE_STATUSES.includes(this.session.status)) throw new Error("维护会话仍在运行，请先停止后再返回设置");
    const id = this.session.id;
    this.session.generation += 1;
    this.releasePaths(this.session);
    this.session = null;
    this.notify(id);
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
    session.status = "stopping";
    session.error = INTERRUPTED;
    this.touch(session);
    const generation = session.generation;
    this.active?.executor.stop();
    await this.awaitCurrentExecution();
    if (!this.isCurrent(session.id, generation)) return;
    if (session.phase === "apply") await this.skipOutstanding(session.id, generation, INTERRUPTED);
    await this.finishSession(session.id, generation, "failed", INTERRUPTED);
  }

  private async startCurrentPhase(sessionId: string, generation: number, message?: string): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["queued", "paused"]);
    if (this.executionPromise) throw new Error("Maintenance coordinator already has an active executor");
    await this.deps.runtime.applyNetworkPolicy?.();
    const now = new Date();
    session.status = "running";
    session.error = null;
    session.timestamps = {
      ...session.timestamps,
      startedAt: session.timestamps.startedAt ?? now,
      completedAt: null,
      updatedAt: now,
    };
    await this.publishStatus(session, "running", message ?? `Starting maintenance ${session.phase}`);
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

  private async runPreview(sessionId: string, generation: number): Promise<void> {
    const scanController = new AbortController();
    this.active = { sessionId, generation, executor: { pause: () => undefined, stop: () => scanController.abort() } };
    try {
      const initial = this.assertCurrent(sessionId, generation, ["running"]);
      const root = await this.deps.roots.getActiveRoot(initial.rootId);
      const persistedRefs = [...initial.refs];
      const entries =
        persistedRefs.length > 0
          ? await scanRefs(this.deps.runtime, root, persistedRefs, scanController.signal)
          : [...(await this.deps.runtime.scan({ root, signal: scanController.signal }))].sort((left, right) =>
              relativePath(root, left).localeCompare(relativePath(root, right), "zh-CN"),
            );
      let current = this.assertCurrent(sessionId, generation, ["running", "paused"]);
      if (persistedRefs.length === 0) {
        const refs = entries.map((entry) => ({ relativePath: relativePath(root, entry) }));
        assertUniqueRefs(refs);
        current.refs = refs;
        this.touch(current);
      }
      if (current.status === "paused") return;
      const committedPaths = new Set([...current.previews.values()].map((preview) => preview.relativePath));
      const pending = entries.filter((entry) => !committedPaths.has(relativePath(root, entry)));
      const executor = new TaskExecutor<LocalScanEntry, PreviewExecutionResult>({
        concurrency: 1,
        gate: {
          beforeItem: async () => void this.assertCurrent(sessionId, generation, ["running"]),
          beforeResult: async () => void this.assertCurrent(sessionId, generation, ["running", "paused"]),
        },
        runItem: async (entry, context) => {
          try {
            const active = this.assertCurrent(sessionId, generation, ["running"]);
            const [item] = await this.deps.runtime.previewEntries({
              root,
              presetId: active.presetId,
              entries: [entry],
              signal: context.signal,
            });
            if (!item) throw new Error("维护预览未返回结果");
            return { entry, item, librarySource: await this.deps.library.resolveSource(entry.fileInfo.filePath) };
          } catch (error) {
            if (isAbortError(error) || context.signal.aborted) throw error;
            return {
              entry,
              item: {
                entry,
                rootId: root.id,
                relativePath: relativePath(root, entry),
                status: "blocked",
                error: errorMessage(error),
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
          this.commitPreview(sessionId, generation, result.item, result.librarySource);
          await this.publishChanged(this.require(sessionId));
        },
      });
      this.active = { sessionId, generation, executor };
      await executor.execute(pending, generation);
      if (!this.isCurrent(sessionId, generation) || this.require(sessionId).status !== "running") return;
      current = this.assertCurrent(sessionId, generation, ["running"]);
      const progress = this.progress(current);
      const allBlocked =
        progress.totalEntries > 0 && progress.successCount === 0 && progress.failedCount >= progress.totalEntries;
      await this.finishSession(
        sessionId,
        generation,
        allBlocked ? "failed" : "completed",
        allBlocked ? PREVIEW_ALL_FAILED : null,
      );
    } catch (error) {
      if (!this.isCurrent(sessionId, generation) || this.closing) return;
      const current = this.require(sessionId);
      if (current.status === "paused") return;
      if (isAbortError(error) || current.status === "stopping" || errorMessage(error) === OWNERSHIP_CHANGED) return;
      await this.failSession(sessionId, generation, errorMessage(error));
    } finally {
      if (this.active?.sessionId === sessionId && this.active.generation === generation) this.active = null;
      this.notify(sessionId);
    }
  }

  private async runApply(sessionId: string, generation: number): Promise<void> {
    try {
      const initial = this.assertCurrent(sessionId, generation, ["running"]);
      const root = await this.deps.roots.getActiveRoot(initial.rootId);
      const pending = this.pendingBatchItems(initial);
      const executor = new TaskExecutor<CurrentBatchItem, ApplyExecutionResult>({
        concurrency: 1,
        gate: {
          beforeItem: async () => void this.assertCurrent(sessionId, generation, ["running"]),
          beforeResult: async () => void this.assertCurrent(sessionId, generation, ["running", "paused"]),
        },
        runItem: async (item, context) => {
          const active = this.markApplyProcessing(sessionId, generation, item);
          if (!active.preview) return { result: { status: "failed", error: "维护预览不存在" } };
          if (active.preview.status === "blocked") {
            return { result: { status: "skipped", error: active.preview.error ?? "维护预览不可应用" } };
          }
          try {
            const [entry] = await scanRefs(
              this.deps.runtime,
              root,
              [{ relativePath: active.preview.relativePath }],
              context.signal,
            );
            if (!entry)
              return { result: { status: "failed", error: `维护文件不存在：${active.preview.relativePath}` } };
            const committed = buildMaintenanceApplyData(entry, active.preview, active.item.selection.fieldSelections);
            const sourceAbsolutePath = active.preview.entry?.fileInfo.filePath ?? entry.fileInfo.filePath;
            const targetAbsolutePath = active.preview.pathDiff?.targetVideoPath ?? sourceAbsolutePath;
            await this.deps.library.preflightRefresh({
              librarySource: active.preview.librarySource,
              sourceAbsolutePath,
              targetAbsolutePath,
            });
            const latest = this.assertCurrent(sessionId, generation, ["running", "paused"]);
            const progress = this.progress(latest);
            const applied = await this.deps.runtime.applyEntry({
              root,
              presetId: latest.presetId,
              entry,
              committed,
              progress: {
                fileIndex: Math.min(progress.totalEntries, progress.completedEntries + 1),
                totalFiles: progress.totalEntries,
              },
              signal: context.signal,
            });
            if (applied.status === "failed") return { result: { status: "failed", error: applied.error } };
            if (!applied.plan?.video) return { result: { status: "failed", error: "维护应用未生成视频发布计划" } };
            const outputRelativePath = applied.outputRelativePath || active.preview.relativePath;
            let file: Awaited<ReturnType<typeof stat>>;
            try {
              file = await stat(applied.plan.video.sourcePath);
            } catch (error) {
              return { result: libraryCommitFailure(error) };
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
              publication: {
                operationId: `${sessionId}:${active.preview.id}`,
                plan: applied.plan,
                refresh: {
                  librarySource: active.preview.librarySource,
                  sourceAbsolutePath,
                  targetAbsolutePath: applied.plan.video.targetPath,
                  size: applied.plan.video.size,
                  modifiedAt: file.mtime,
                  crawlerData,
                  fallbackNumber: applied.entry.fileInfo.number,
                  assets: applied.entry.assets,
                  refreshedAt: new Date(),
                },
              },
            };
          } catch (error) {
            const stopped = isAbortError(error) || context.signal.aborted;
            return {
              result: { status: stopped ? "skipped" : "failed", error: stopped ? STOPPED_ITEM : errorMessage(error) },
            };
          }
        },
        applyResult: async (item, executionResult) => {
          let result = executionResult.result;
          if (executionResult.publication) {
            try {
              this.assertCurrent(sessionId, generation, ["running", "paused"]);
              await this.deps.library.publishRefresh(executionResult.publication);
            } catch (error) {
              if (!this.isCurrent(sessionId, generation)) throw error;
              result = libraryCommitFailure(error);
            }
          }
          await this.commitItem(sessionId, generation, item, result);
        },
      });
      this.active = { sessionId, generation, executor };
      await executor.execute(pending, generation);
      if (!this.isCurrent(sessionId, generation) || this.require(sessionId).status !== "running") return;
      const current = this.assertCurrent(sessionId, generation, ["running"]);
      const progress = this.progress(current);
      const failedAll =
        progress.totalEntries > 0 && progress.successCount === 0 && progress.failedCount >= progress.totalEntries;
      await this.finishSession(
        sessionId,
        generation,
        failedAll ? "failed" : "completed",
        failedAll ? APPLY_FAILED : null,
      );
    } catch (error) {
      if (!this.isCurrent(sessionId, generation) || this.closing) return;
      const current = this.require(sessionId);
      if (current.status === "paused") return;
      if (isAbortError(error) || current.status === "stopping" || errorMessage(error) === OWNERSHIP_CHANGED) return;
      const message = errorMessage(error);
      await this.skipOutstanding(sessionId, generation, message);
      await this.failSession(sessionId, generation, message);
    } finally {
      if (this.active?.sessionId === sessionId && this.active.generation === generation) this.active = null;
      this.notify(sessionId);
    }
  }

  private commitPreview(
    sessionId: string,
    generation: number,
    item: MaintenanceRuntimePreviewItem,
    librarySource: MaintenanceLibrarySource | null,
  ): void {
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
    if ([...session.previews.values()].some((existing) => existing.relativePath === preview.relativePath)) {
      throw new Error(`维护预览路径重复：${preview.relativePath}`);
    }
    session.previews.set(preview.id, preview);
    this.touch(session, now);
  }

  private markApplyProcessing(sessionId: string, generation: number, item: CurrentBatchItem) {
    const session = this.assertCurrent(sessionId, generation, ["running"]);
    const current = session.currentBatch?.items.get(item.selection.previewId);
    if (!current || current.id !== item.id || current.status !== "pending") throw new Error(OWNERSHIP_CHANGED);
    current.status = "processing";
    current.error = null;
    current.updatedAt = new Date();
    this.touch(session);
    return { item: current, preview: session.previews.get(item.selection.previewId) };
  }

  private async commitItem(
    sessionId: string,
    generation: number,
    item: CurrentBatchItem,
    result: MaintenanceApplyItemResult,
  ): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused", "stopping"]);
    const current = session.currentBatch?.items.get(item.selection.previewId);
    if (!current || current.id !== item.id || TERMINAL_ITEM_STATUSES.has(current.status)) return;
    const preview = session.previews.get(item.selection.previewId);
    if (!preview) return;
    const now = new Date();
    current.status = result.status;
    current.error = result.error ?? null;
    current.result = result;
    current.updatedAt = now;
    preview.status = result.status === "success" ? "applied" : "failed";
    preview.error = result.error ?? null;
    preview.updatedAt = now;
    delete session.draft.fieldSelections[preview.id];
    this.touch(session, now);
    await this.publishChanged(session);
  }

  private async skipOutstanding(sessionId: string, generation: number, error: string): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused", "stopping"]);
    const items = session.currentBatch
      ? [...session.currentBatch.items.values()].filter(
          (item) => item.status === "pending" || item.status === "processing",
        )
      : [];
    for (const item of items) await this.commitItem(sessionId, generation, item, { status: "skipped", error });
  }

  private async waitForApply(
    taskId: string,
    batchId: string,
    selectedIds: ReadonlySet<string>,
  ): Promise<MaintenanceApplyBatch> {
    for (;;) {
      const session = this.require(taskId);
      if (session.status === "completed" || session.status === "failed") {
        if (session.currentBatch?.id !== batchId) throw new Error("维护批次已变化");
        return {
          task: this.task(session),
          batchId,
          items: this.editablePreviews(session),
          applied: this.applyLogs(session).filter((log) => selectedIds.has(log.previewId)),
        };
      }
      await this.waitForChange(taskId);
    }
  }

  private async finishSession(
    sessionId: string,
    generation: number,
    status: "completed" | "failed",
    error: string | null,
  ): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["running", "stopping"]);
    const now = new Date();
    session.status = status;
    session.error = error;
    session.timestamps = { ...session.timestamps, completedAt: now, updatedAt: now };
    this.releasePaths(session);
    const progress = this.progress(session);
    const message =
      session.phase === "preview"
        ? status === "failed"
          ? (error ?? "维护预览失败")
          : `Maintenance preview completed. Ready: ${progress.successCount}, Blocked: ${progress.failedCount}`
        : status === "failed"
          ? (error ?? APPLY_FAILED)
          : `Maintenance completed. Succeeded: ${progress.successCount}, Failed: ${progress.failedCount}`;
    await this.publishStatus(session, status, message);
  }

  private releasePaths(session: Session): void {
    for (const release of session.releasePaths.splice(0)) release();
  }

  private async failSession(sessionId: string, generation: number, error: string): Promise<void> {
    if (!this.isCurrent(sessionId, generation)) return;
    const session = this.require(sessionId);
    if (session.status !== "running" && session.status !== "stopping") return;
    await this.finishSession(sessionId, generation, "failed", error);
  }

  private progress(session: Session): MaintenanceTaskProgress {
    if (session.phase === "preview") {
      const previews = [...session.previews.values()];
      return {
        totalEntries: session.refs.length,
        completedEntries: previews.length,
        successCount: previews.filter((preview) => preview.status === "ready").length,
        failedCount: previews.filter((preview) => preview.status === "blocked").length,
      };
    }
    const items = session.currentBatch ? [...session.currentBatch.items.values()] : [];
    const terminal = items.filter((item) => TERMINAL_ITEM_STATUSES.has(item.status));
    return {
      totalEntries: items.length,
      completedEntries: terminal.length,
      successCount: terminal.filter((item) => item.status === "success").length,
      failedCount: terminal.filter((item) => item.status !== "success").length,
    };
  }

  private task(session: Session): MaintenanceTaskSnapshot {
    return {
      id: session.id,
      rootId: session.rootId,
      status: session.status,
      ...this.progress(session),
      createdAt: session.timestamps.createdAt,
      updatedAt: session.timestamps.updatedAt,
      startedAt: session.timestamps.startedAt,
      completedAt: session.timestamps.completedAt,
      error: session.error,
    };
  }

  private snapshot(session: Session): MaintenanceActiveSessionSnapshot {
    return {
      id: session.id,
      rootId: session.rootId,
      presetId: session.presetId,
      phase: session.phase,
      status: session.status,
      generation: session.generation,
      refs: session.refs.map((ref) => ({ ...ref })),
      ...this.progress(session),
      timestamps: { ...session.timestamps },
      error: session.error,
      previews: this.editablePreviews(session),
      currentBatch: session.currentBatch
        ? {
            id: session.currentBatch.id,
            items: [...session.currentBatch.items.values()].map((item) => ({
              ...item,
              selection: {
                ...item.selection,
                fieldSelections: item.selection.fieldSelections && { ...item.selection.fieldSelections },
              },
            })),
          }
        : null,
      draft: {
        fieldSelections: Object.fromEntries(
          Object.entries(session.draft.fieldSelections).map(([id, value]) => [id, { ...value }]),
        ),
      },
    };
  }

  private editablePreviews(session: Session): MaintenanceTaskPreview[] {
    return [...session.previews.values()]
      .filter((preview) => preview.status === "ready" || preview.status === "blocked")
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
  }

  private applyLogs(session: Session): MaintenanceTaskApplyLog[] {
    if (!session.currentBatch) return [];
    const batchId = session.currentBatch.id;
    return [...session.currentBatch.items.values()]
      .filter((item) => TERMINAL_ITEM_STATUSES.has(item.status))
      .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
      .flatMap((item) => {
        const preview = session.previews.get(item.selection.previewId);
        return preview
          ? [
              {
                id: item.id,
                taskId: session.id,
                batchId,
                previewId: preview.id,
                rootId: preview.rootId,
                relativePath: preview.relativePath,
                presetId: preview.presetId,
                status: item.status as "success" | "failed" | "skipped",
                error: item.error,
                appliedAt: item.updatedAt,
              },
            ]
          : [];
      });
  }

  private pendingBatchItems(session: Session): CurrentBatchItem[] {
    return session.currentBatch
      ? [...session.currentBatch.items.values()]
          .filter((item) => item.status === "pending")
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      : [];
  }

  private require(taskId: string): Session {
    if (!this.session || this.session.id !== taskId) throw new Error(`Maintenance task not found: ${taskId}`);
    return this.session;
  }

  private isCurrent(sessionId: string, generation: number): boolean {
    return Boolean(this.session && this.session.id === sessionId && this.session.generation === generation);
  }

  private assertCurrent(sessionId: string, generation: number, statuses?: readonly MaintenanceTaskStatus[]): Session {
    const session = this.session;
    if (!session || session.id !== sessionId || session.generation !== generation) throw new Error(OWNERSHIP_CHANGED);
    if (statuses && !statuses.includes(session.status)) throw new Error(OWNERSHIP_CHANGED);
    return session;
  }

  private activeFor(sessionId: string, generation: number): ActiveExecution | null {
    return this.active?.sessionId === sessionId && this.active.generation === generation ? this.active : null;
  }

  private touch(session: Session, now = new Date()): void {
    session.timestamps.updatedAt = now;
  }

  private async publishStatus(session: Session, type: string, message: string): Promise<void> {
    await this.publishChanged(session);
    await this.publishLog(session, type, message);
  }

  private async publishChanged(session: Session): Promise<void> {
    await this.deps.events?.publish({ kind: "task-changed", task: this.task(session) });
    this.notify(session.id);
  }

  private async publishLog(session: Session, type: string, message: string): Promise<void> {
    await this.deps.events?.publish({
      kind: "log",
      taskId: session.id,
      event: { id: randomUUID(), taskId: session.id, type, message, createdAt: new Date() },
    });
    this.notify(session.id);
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
