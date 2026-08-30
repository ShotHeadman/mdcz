import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { type MediaRoot, resolveRootFile, resolveRootRelativePath } from "@mdcz/media-store";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyBatch,
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenanceLibrarySource,
  MaintenancePreviewBatch,
  MaintenanceSessionEvent,
  MaintenanceSessionPreview,
  MaintenanceSessionRef,
  MaintenanceSessionSnapshot,
  MaintenanceSessionStatus,
} from "@mdcz/shared/maintenanceTasks";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { CrawlerData, DiscoveredAssets, LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import type { PreparedPublicationPlan } from "../publication";
import { isAbortError } from "../scrape/utils/abort";
import { TaskExecutor, type TaskExecutorContext } from "../tasks";
import {
  type MaintenanceBatchItem,
  MaintenanceSession,
  StaleMaintenanceGenerationError,
} from "../tasks/session/MaintenanceSession";
import { buildMaintenanceApplyData } from "./applyData";
import type { MaintenanceRuntime, MaintenanceRuntimePreviewItem } from "./MaintenanceRuntime";

export interface MaintenanceRootPort {
  get(rootId: string): Promise<MediaRoot>;
  list(): Promise<MediaRoot[]>;
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
    ownershipToken: string;
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
  | { kind: "session-changed"; session: MaintenanceSessionSnapshot }
  | { kind: "log"; sessionId: string; event: MaintenanceSessionEvent };

export interface MaintenanceRunHandle<TResult> {
  session: MaintenanceSessionSnapshot;
  completion: Promise<TResult>;
}

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

const PREVIEW_ALL_FAILED = "维护预览全部失败";
const APPLY_FAILED = "维护应用失败";
const STOPPED = "维护已停止";
const STOPPED_ITEM = "维护已停止，项目未执行";
const INTERRUPTED = "维护因服务关闭而中断，请重新预览后执行";
const OWNERSHIP_CHANGED = "Maintenance execution ownership changed";

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const refKey = (ref: RootFileRef): string => `${ref.rootId}\0${ref.relativePath}`;

const assertUniqueRefs = (refs: readonly MaintenanceSessionRef[]): void => {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref.relativePath.trim()) throw new Error("维护文件相对路径不能为空");
    const key = refKey(ref);
    if (seen.has(key)) throw new Error(`维护文件路径重复：${ref.rootId}:${ref.relativePath}`);
    seen.add(key);
  }
};

const canonicalizeRefs = async (
  roots: MaintenanceRootPort,
  refs: readonly MaintenanceSessionRef[],
): Promise<MaintenanceSessionRef[]> => {
  const registeredRoots = await roots.list();
  const rootsById = new Map(registeredRoots.map((root) => [root.id, root]));
  const canonical = refs.map((ref) => {
    const referencedRoot = rootsById.get(ref.rootId);
    if (!referencedRoot) throw new Error(`Media root not found: ${ref.rootId}`);
    const resolved = resolveRootFile(registeredRoots, resolveRootRelativePath(referencedRoot, ref.relativePath));
    return { rootId: resolved.root.id, relativePath: resolved.relativePath };
  });
  assertUniqueRefs(canonical);
  return canonical;
};

const ownedPreviewPaths = (
  roots: readonly MediaRoot[],
  previews: readonly MaintenanceSessionPreview[],
): RootFileRef[] => {
  const paths = new Map<string, RootFileRef>();
  for (const preview of previews) {
    const entry = preview.entry;
    for (const absolutePath of [
      entry?.fileInfo.filePath,
      preview.pathDiff?.currentVideoPath,
      preview.pathDiff?.targetVideoPath,
      entry?.nfoPath,
      entry?.assets.thumb,
      entry?.assets.poster,
      entry?.assets.fanart,
      entry?.assets.trailer,
      ...(entry?.assets.sceneImages ?? []),
      ...(entry?.assets.actorPhotos ?? []),
    ]) {
      if (!absolutePath) continue;
      const resolved = resolveRootFile(roots, absolutePath);
      const ref = { rootId: resolved.root.id, relativePath: resolved.relativePath };
      paths.set(refKey(ref), ref);
    }
  }
  return [...paths.values()];
};

const scanRefs = async (
  runtime: MaintenanceRuntime,
  roots: MaintenanceRootPort,
  refs: readonly MaintenanceSessionRef[],
  signal?: AbortSignal,
): Promise<LocalScanEntry[]> => {
  assertUniqueRefs(refs);
  const refsByRoot = new Map<string, MaintenanceSessionRef[]>();
  for (const ref of refs) {
    const group = refsByRoot.get(ref.rootId) ?? [];
    group.push(ref);
    refsByRoot.set(ref.rootId, group);
  }
  const byRef = new Map<string, LocalScanEntry>();
  for (const [rootId, group] of refsByRoot) {
    const root = await roots.get(rootId);
    const entries = await runtime.scanRefs({
      root,
      refs: group.map(({ relativePath }) => ({ relativePath })),
      signal,
    });
    for (const entry of entries) {
      const ref = { rootId, relativePath: entry.ref.relativePath };
      const key = refKey(ref);
      if (byRef.has(key)) throw new Error(`维护扫描结果路径重复：${rootId}:${entry.ref.relativePath}`);
      byRef.set(key, { ...entry, ref });
    }
  }
  if (byRef.size !== refs.length || refs.some((ref) => !byRef.has(refKey(ref)))) {
    throw new Error("维护扫描结果与请求文件不一致");
  }
  return refs.map((ref) => byRef.get(refKey(ref)) as LocalScanEntry);
};

const libraryCommitFailure = (error: unknown): MaintenanceApplyItemResult => ({
  status: "failed",
  error: `文件操作已完成，但媒体库提交失败：${errorMessage(error)}。请重新扫描并预览，以磁盘实际状态重新协调。`,
});

export class MaintenanceSessionCoordinator {
  private session: MaintenanceSession | null = null;
  private active: ActiveExecution | null = null;
  private executionPromise: Promise<void> | null = null;
  private readonly changeWaiters = new Map<string, Set<() => void>>();
  private revision = 0;
  private releaseOwnedPaths: (() => void) | null = null;
  private closing = false;

  constructor(
    private readonly deps: {
      roots: MaintenanceRootPort;
      runtime: MaintenanceRuntime;
      library: MaintenanceLibraryPort;
      events?: { publish(event: MaintenanceCoordinatorEvent): void | Promise<void> };
      acquireAll?: (refs: readonly RootFileRef[], owner: string) => () => void;
    },
  ) {}

  async startPreview(input: {
    rootId: string;
    presetId: MaintenancePresetId;
    refs: readonly MaintenanceSessionRef[];
  }): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    this.assertOpen();
    if (input.refs.length === 0) throw new Error("维护文件不能为空");
    const refs = await canonicalizeRefs(this.deps.roots, input.refs);
    await this.deps.roots.get(input.rootId);
    for (const rootId of new Set(refs.map((ref) => ref.rootId))) await this.deps.roots.get(rootId);
    if (this.session?.isActive()) {
      throw new Error("已有活动的维护会话，请先完成或停止当前会话");
    }
    const generation = (this.session?.generation ?? 0) + 1;
    this.session?.invalidate();
    this.session = new MaintenanceSession({
      id: randomUUID(),
      rootId: input.rootId,
      presetId: input.presetId,
      generation,
      refs,
    });
    await this.publishStatus(this.session, "queued", `Maintenance session queued. Preset: ${input.presetId}`);
    await this.publishLog(this.session, "preset", `Maintenance preset: ${input.presetId}`);
    await this.startCurrentPhase(this.session.id, generation);
    return { session: this.session.statusSnapshot(), completion: this.waitForPreview(this.session.id) };
  }

  async readPreview(sessionId: string): Promise<MaintenancePreviewBatch> {
    const session = this.require(sessionId);
    return { session: session.statusSnapshot(), items: session.editablePreviews() };
  }

  async waitForPreview(sessionId: string): Promise<MaintenancePreviewBatch> {
    for (;;) {
      const revision = this.revision;
      const batch = await this.readPreview(sessionId);
      if (batch.session.status === "completed") return batch;
      if (batch.session.status === "failed") {
        if (batch.session.error === PREVIEW_ALL_FAILED) return batch;
        throw new Error(batch.session.error ?? "维护预览失败");
      }
      await this.waitForChange(sessionId, revision);
    }
  }

  async beginApply(input: {
    sessionId: string;
    selections: readonly MaintenanceApplySelection[];
  }): Promise<MaintenanceRunHandle<MaintenanceApplyBatch>> {
    this.assertOpen();
    if (input.selections.length === 0) throw new Error("请选择要应用的维护预览");
    const previewIds = input.selections.map((selection) => selection.previewId);
    const session = this.require(input.sessionId);
    const previews = previewIds
      .map((previewId) => session.preview(previewId))
      .filter((preview) => preview !== undefined);
    if (previews.length !== previewIds.length) throw new Error("部分维护预览不存在、已提交或不属于当前会话");
    const refs = ownedPreviewPaths(await this.deps.roots.list(), previews);
    const acquireAll = this.deps.acquireAll ?? ((owned, owner) => mediaPathOwnership.acquireAll(owned, owner));
    const release = acquireAll(refs, session.id);
    let apply: { generation: number; batchId: string };
    try {
      apply = session.beginApply(input.selections);
    } catch (error) {
      release();
      throw error;
    }
    this.releaseOwnedPaths = release;
    try {
      await this.publishStatus(session, "queued", `Maintenance apply queued. Items: ${input.selections.length}`);
      await this.startCurrentPhase(session.id, apply.generation);
    } catch (error) {
      const message = errorMessage(error);
      const generation = session.beginStopping(message);
      session.finish(generation, "failed", message);
      this.releasePaths();
      throw error;
    }
    return {
      session: session.statusSnapshot(),
      completion: this.waitForApply(session.id, apply.batchId, new Set(previewIds)),
    };
  }

  async pause(sessionId: string): Promise<MaintenanceSessionSnapshot> {
    const session = this.require(sessionId);
    if (!session.pause()) return session.statusSnapshot();
    await this.publishStatus(session, "paused", "Maintenance session paused");
    this.activeFor(session.id, session.generation)?.executor.pause();
    await this.awaitCurrentExecution();
    return this.require(sessionId).statusSnapshot();
  }

  async resume(sessionId: string): Promise<MaintenanceSessionSnapshot> {
    const session = this.require(sessionId);
    if (session.status !== "paused") return session.statusSnapshot();
    await this.awaitCurrentExecution();
    const current = this.require(sessionId);
    if (current.status !== "paused") return current.statusSnapshot();
    await this.startCurrentPhase(current.id, current.generation, "Maintenance session resumed");
    return current.statusSnapshot();
  }

  async stop(sessionId: string): Promise<MaintenanceSessionSnapshot> {
    const current = this.require(sessionId);
    if (current.status === "completed" || current.status === "failed") return current.statusSnapshot();
    const generation = current.beginStopping(STOPPED);
    await this.publishStatus(current, "stopping", "Stopping maintenance session");
    this.active?.executor.stop();
    await this.awaitCurrentExecution();
    const latest = this.require(sessionId);
    if (latest.generation !== generation) return latest.statusSnapshot();
    if (latest.phase === "apply") await this.skipOutstanding(latest.id, generation, STOPPED_ITEM);
    await this.finishSession(latest.id, generation, "failed", STOPPED);
    return latest.statusSnapshot();
  }

  async getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null> {
    return this.session?.snapshot() ?? null;
  }

  async updateDraft(input: {
    sessionId: string;
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
  }): Promise<MaintenanceActiveSessionSnapshot> {
    const session = this.require(input.sessionId);
    session.updateDraft(input.previewId, input.fieldSelections);
    await this.publishChanged(session);
    return session.snapshot();
  }

  async discardSession(sessionId?: string): Promise<void> {
    if (!this.session) return;
    if (sessionId && this.session.id !== sessionId) throw new Error("维护会话已变化");
    if (this.session.isActive()) throw new Error("维护会话仍在运行，请先停止后再返回设置");
    const id = this.session.id;
    this.session.invalidate();
    this.releasePaths();
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
    if (!session?.isActive()) {
      session?.invalidate();
      this.releasePaths();
      return;
    }
    const generation = session.beginStopping(INTERRUPTED);
    this.active?.executor.stop();
    await this.awaitCurrentExecution();
    if (!this.isCurrent(session.id, generation)) return;
    if (session.phase === "apply") await this.skipOutstanding(session.id, generation, INTERRUPTED);
    await this.finishSession(session.id, generation, "failed", INTERRUPTED);
  }

  private async startCurrentPhase(sessionId: string, generation: number, message?: string): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["queued", "paused"]);
    const expectedStatus = session.status;
    if (this.executionPromise) throw new Error("Maintenance coordinator already has an active executor");
    await this.deps.runtime.applyNetworkPolicy?.();
    if (!this.isCurrent(sessionId, generation) || this.require(sessionId).status !== expectedStatus) return;
    session.startRunning(generation);
    await this.publishStatus(session, "running", message ?? `Starting maintenance ${session.phase}`);
    if (!this.isCurrent(sessionId, generation) || this.require(sessionId).status !== "running") return;
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
      const persistedRefs = [...initial.refs];
      const entries = (await scanRefs(this.deps.runtime, this.deps.roots, persistedRefs, scanController.signal)).sort(
        (left, right) => refKey(left.ref).localeCompare(refKey(right.ref), "zh-CN"),
      );
      let current = this.assertCurrent(sessionId, generation, ["running", "paused"]);
      if (current.status === "paused") return;
      const committedPaths = new Set(current.snapshot().previews.map(refKey));
      const pending = entries.filter((entry) => !committedPaths.has(refKey(entry.ref)));
      await this.executeItems<LocalScanEntry, PreviewExecutionResult>(sessionId, generation, pending, {
        runItem: async (entry, context) => {
          const root = await this.deps.roots.get(entry.ref.rootId);
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
                rootId: entry.ref.rootId,
                relativePath: entry.ref.relativePath,
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
      if (!this.isCurrent(sessionId, generation) || this.require(sessionId).status !== "running") return;
      current = this.assertCurrent(sessionId, generation, ["running"]);
      const progress = current.progress();
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
      if (isAbortError(error) || current.status === "stopping" || error instanceof StaleMaintenanceGenerationError)
        return;
      await this.failSession(sessionId, generation, errorMessage(error));
    } finally {
      if (this.active?.sessionId === sessionId && this.active.generation === generation) this.active = null;
      this.notify(sessionId);
    }
  }

  private async runApply(sessionId: string, generation: number): Promise<void> {
    try {
      const initial = this.assertCurrent(sessionId, generation, ["running"]);
      const pending = initial.pendingBatchItems();
      await this.executeItems<MaintenanceBatchItem, ApplyExecutionResult>(sessionId, generation, pending, {
        runItem: async (item, context) => {
          const active = this.markApplyProcessing(sessionId, generation, item);
          if (!active.preview) return { result: { status: "failed", error: "维护预览不存在" } };
          if (active.preview.status === "blocked") {
            return { result: { status: "skipped", error: active.preview.error ?? "维护预览不可应用" } };
          }
          try {
            const root = await this.deps.roots.get(active.preview.rootId);
            const [entry] = await scanRefs(
              this.deps.runtime,
              this.deps.roots,
              [{ rootId: active.preview.rootId, relativePath: active.preview.relativePath }],
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
            const progress = latest.progress();
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
                ownershipToken: sessionId,
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
      if (!this.isCurrent(sessionId, generation) || this.require(sessionId).status !== "running") return;
      const current = this.assertCurrent(sessionId, generation, ["running"]);
      const progress = current.progress();
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
      if (isAbortError(error) || current.status === "stopping" || error instanceof StaleMaintenanceGenerationError)
        return;
      const message = errorMessage(error);
      await this.skipOutstanding(sessionId, generation, message);
      await this.failSession(sessionId, generation, message);
    } finally {
      if (this.active?.sessionId === sessionId && this.active.generation === generation) this.active = null;
      this.notify(sessionId);
    }
  }

  private async executeItems<TItem, TResult>(
    sessionId: string,
    generation: number,
    items: readonly TItem[],
    execution: {
      runItem(item: TItem, context: TaskExecutorContext): Promise<TResult>;
      applyResult(item: TItem, result: TResult, context: TaskExecutorContext): Promise<unknown>;
    },
  ): Promise<void> {
    const executor = new TaskExecutor<TItem, TResult>({
      concurrency: 1,
      gate: {
        beforeItem: async () => void this.assertCurrent(sessionId, generation, ["running"]),
        beforeResult: async () => void this.assertCurrent(sessionId, generation, ["running", "paused"]),
      },
      ...execution,
    });
    this.active = { sessionId, generation, executor };
    await executor.execute(items);
  }

  private commitPreview(
    sessionId: string,
    generation: number,
    item: MaintenanceRuntimePreviewItem,
    librarySource: MaintenanceLibrarySource | null,
  ): void {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused"]);
    session.addPreview(generation, {
      rootId: item.rootId,
      relativePath: item.relativePath,
      status: item.status,
      error: item.error,
      fieldDiffs: item.fieldDiffs,
      unchangedFieldDiffs: item.unchangedFieldDiffs,
      pathDiff: item.pathDiff,
      proposedCrawlerData: item.proposedCrawlerData,
      imageAlternatives: item.imageAlternatives,
      entry: item.entry,
      librarySource: librarySource ?? undefined,
    });
  }

  private markApplyProcessing(sessionId: string, generation: number, item: MaintenanceBatchItem) {
    const session = this.assertCurrent(sessionId, generation, ["running"]);
    return session.markApplyProcessing(generation, item);
  }

  private async commitItem(
    sessionId: string,
    generation: number,
    item: MaintenanceBatchItem,
    result: MaintenanceApplyItemResult,
  ): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused", "stopping"]);
    if (session.commitItem(generation, item, result)) await this.publishChanged(session);
  }

  private async skipOutstanding(sessionId: string, generation: number, error: string): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused", "stopping"]);
    if (session.skipOutstanding(generation, error)) await this.publishChanged(session);
  }

  private async waitForApply(
    sessionId: string,
    batchId: string,
    selectedIds: ReadonlySet<string>,
  ): Promise<MaintenanceApplyBatch> {
    for (;;) {
      const revision = this.revision;
      const session = this.require(sessionId);
      if (session.status === "completed" || session.status === "failed") {
        if (session.snapshot().currentBatch?.id !== batchId) throw new Error("维护批次已变化");
        return {
          session: session.statusSnapshot(),
          batchId,
          items: session.editablePreviews(),
          applied: session.applyLogs().filter((log) => selectedIds.has(log.previewId)),
        };
      }
      await this.waitForChange(sessionId, revision);
    }
  }

  private async finishSession(
    sessionId: string,
    generation: number,
    status: "completed" | "failed",
    error: string | null,
  ): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["running", "stopping"]);
    session.finish(generation, status, error);
    this.releasePaths();
    const progress = session.progress();
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

  private releasePaths(): void {
    this.releaseOwnedPaths?.();
    this.releaseOwnedPaths = null;
  }

  private async failSession(sessionId: string, generation: number, error: string): Promise<void> {
    if (!this.isCurrent(sessionId, generation)) return;
    const session = this.require(sessionId);
    if (session.status !== "running" && session.status !== "stopping") return;
    await this.finishSession(sessionId, generation, "failed", error);
  }

  private require(sessionId: string): MaintenanceSession {
    if (!this.session || this.session.id !== sessionId) throw new Error(`Maintenance session not found: ${sessionId}`);
    return this.session;
  }

  private isCurrent(sessionId: string, generation: number): boolean {
    return Boolean(this.session && this.session.id === sessionId && this.session.generation === generation);
  }

  private assertCurrent(
    sessionId: string,
    generation: number,
    statuses?: readonly MaintenanceSessionStatus[],
  ): MaintenanceSession {
    const session = this.session;
    if (!session || session.id !== sessionId) throw new StaleMaintenanceGenerationError(OWNERSHIP_CHANGED);
    session.assertGeneration(generation, statuses);
    return session;
  }

  private activeFor(sessionId: string, generation: number): ActiveExecution | null {
    return this.active?.sessionId === sessionId && this.active.generation === generation ? this.active : null;
  }

  private async publishStatus(session: MaintenanceSession, type: string, message: string): Promise<void> {
    await this.publishChanged(session);
    await this.publishLog(session, type, message);
  }

  private async publishChanged(session: MaintenanceSession): Promise<void> {
    await this.deps.events?.publish({ kind: "session-changed", session: session.statusSnapshot() });
    this.notify(session.id);
  }

  private async publishLog(session: MaintenanceSession, type: string, message: string): Promise<void> {
    await this.deps.events?.publish({
      kind: "log",
      sessionId: session.id,
      event: { id: randomUUID(), sessionId: session.id, type, message, createdAt: new Date() },
    });
    this.notify(session.id);
  }

  private notify(sessionId: string): void {
    this.revision += 1;
    const waiters = this.changeWaiters.get(sessionId);
    if (!waiters) return;
    this.changeWaiters.delete(sessionId);
    for (const waiter of waiters) waiter();
  }

  private waitForChange(sessionId: string, since: number): Promise<void> {
    if (this.revision !== since) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = this.changeWaiters.get(sessionId) ?? new Set<() => void>();
      waiters.add(resolve);
      this.changeWaiters.set(sessionId, waiters);
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
