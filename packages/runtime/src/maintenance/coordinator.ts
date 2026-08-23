import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { type MediaRoot, toRootRelativePath } from "@mdcz/media-store";
import { buildMaintenanceApplyCommit } from "@mdcz/shared/maintenanceCommit";
import type {
  MaintenanceApplyBatch,
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenanceExecutionOwner,
  MaintenancePreviewBatch,
  MaintenanceTaskApplyQueueItem,
  MaintenanceTaskPatch,
  MaintenanceTaskPreview,
  MaintenanceTaskProgress,
  MaintenanceTaskRef,
  MaintenanceTaskSnapshot,
  MaintenanceTaskStatus,
} from "@mdcz/shared/maintenanceTasks";
import type { LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";
import { isAbortError } from "../scrape/utils/abort";
import { TaskExecutor, TaskScheduler, transitionTask } from "../tasks";
import {
  type MaintenanceCoordinatorEvent,
  type MaintenanceCoordinatorEventSink,
  type MaintenanceLibraryPort,
  type MaintenanceRootPort,
  type MaintenanceRunHandle,
  type MaintenanceTaskStore,
  noopMaintenanceCoordinatorEventSink,
} from "./coordinatorContracts";
import type { MaintenanceRuntime, MaintenanceRuntimePreviewItem } from "./MaintenanceRuntime";

const PREVIEW_ALL_FAILED = "维护预览全部失败";
const APPLY_FAILED = "维护应用失败";
const STOPPED = "维护已停止";
const STOPPED_ITEM = "维护已停止，项目未执行";
const INTERRUPTED_APPLY = "维护应用因服务关闭而中断，请重新预览后执行";

type ActiveExecution = {
  owner: MaintenanceExecutionOwner;
  phase: "preview" | "apply";
  executor: { pause(): void; stop(): void; waitForIdle(): Promise<void> };
};

interface MaintenanceTaskCoordinatorDependencies {
  store: MaintenanceTaskStore;
  roots: MaintenanceRootPort;
  runtime: MaintenanceRuntime;
  library: MaintenanceLibraryPort;
  events?: MaintenanceCoordinatorEventSink;
  concurrency: 1;
}

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const taskPatchFor = (
  task: MaintenanceTaskSnapshot,
  action: "pause" | "resume" | "stop" | "complete" | "fail" | "retry",
  options: {
    error?: string | null;
    progress?: MaintenanceTaskProgress;
    event?: { type: string; message: string };
  } = {},
): MaintenanceTaskPatch => {
  const next = transitionTask(task, { action, error: options.error });
  return {
    status: next.status as MaintenanceTaskStatus,
    startedAt: next.startedAt,
    completedAt: next.completedAt,
    error: next.error,
    progress: options.progress,
    event: options.event,
  };
};

export class MaintenanceTaskCoordinator {
  private readonly store: MaintenanceTaskStore;
  private readonly roots: MaintenanceRootPort;
  private readonly runtime: MaintenanceRuntime;
  private readonly library: MaintenanceLibraryPort;
  private readonly events: MaintenanceCoordinatorEventSink;
  private readonly scheduler: TaskScheduler<import("@mdcz/shared/maintenanceTasks").MaintenanceTaskClaim>;
  private readonly active = new Map<string, ActiveExecution>();
  private readonly changeWaiters = new Map<string, Set<() => void>>();
  private closing = false;

  constructor(deps: MaintenanceTaskCoordinatorDependencies) {
    if (deps.concurrency !== 1) throw new Error("Maintenance coordinator concurrency must be 1");
    this.store = deps.store;
    this.roots = deps.roots;
    this.runtime = deps.runtime;
    this.library = deps.library;
    this.events = deps.events ?? noopMaintenanceCoordinatorEventSink;
    this.scheduler = new TaskScheduler({
      claimNext: async () => await this.store.claimNext(),
      runExecution: async (claim) => {
        if (claim.phase === "preview") await this.runPreview(claim.task, claim.execution.refs);
        else await this.runApply(claim.task);
      },
    });
  }

  async startPreview(input: {
    rootId: string;
    presetId: MaintenancePresetId;
    refs?: readonly MaintenanceTaskRef[];
  }): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    this.assertOpen();
    if (input.refs) this.assertUniqueRefs(input.refs);
    await this.roots.getActiveRoot(input.rootId);
    const task = await this.store.createPreviewExecution(input);
    await this.publish({ kind: "task-changed", task });
    this.scheduler.drain();
    return { task, completion: this.waitForPreview(task.id) };
  }

  async readPreview(taskId: string): Promise<MaintenancePreviewBatch> {
    return { task: await this.store.readTask(taskId), items: await this.store.listPreviews(taskId) };
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
    const ids = input.selections.map((selection) => selection.previewId);
    if (new Set(ids).size !== ids.length) throw new Error("维护预览 ID 重复");
    const current = await this.store.readTask(input.taskId);
    if (current.status !== "completed" && current.status !== "failed") {
      throw new Error("维护预览生成完成后才能应用");
    }
    const progress: MaintenanceTaskProgress = {
      totalEntries: input.selections.length,
      completedEntries: 0,
      successCount: 0,
      failedCount: 0,
    };
    const task = await this.store.queueApply({
      taskId: input.taskId,
      expectedExecutionVersion: current.executionVersion,
      selections: input.selections,
      patch: taskPatchFor(current, "retry", {
        progress,
        event: { type: "queued", message: `Maintenance apply queued. Items: ${input.selections.length}` },
      }),
    });
    if (!task) throw new Error("维护任务状态已变化，请重试");
    await this.publishTask(task);
    this.scheduler.drain();
    const selectedIds = new Set(ids);
    const execution = await this.store.readExecution(input.taskId);
    if (!execution.batchId) throw new Error("维护批次未创建");
    return {
      task,
      completion: this.waitForApply(input.taskId, execution.batchId, selectedIds),
    };
  }

  async pause(taskId: string): Promise<MaintenanceTaskSnapshot> {
    const current = await this.store.readTask(taskId);
    if (current.status !== "queued" && current.status !== "running") return current;
    const owner = { taskId, executionVersion: current.executionVersion };
    const paused = await this.store.transition({
      owner,
      expectedStatus: current.status,
      patch: taskPatchFor(current, "pause", {
        event: { type: "paused", message: "Maintenance task paused" },
      }),
    });
    if (!paused) return await this.store.readTask(taskId);
    if (current.status === "running") this.active.get(taskId)?.executor.pause();
    await this.publishTask(paused);
    return paused;
  }

  async resume(taskId: string): Promise<MaintenanceTaskSnapshot> {
    let current = await this.store.readTask(taskId);
    if (current.status !== "paused") return current;
    const active = this.active.get(taskId);
    if (active?.owner.executionVersion === current.executionVersion) {
      await active.executor.waitForIdle();
      current = await this.store.readTask(taskId);
      if (current.status !== "paused") return current;
    }
    const resumed = await this.store.transition({
      owner: { taskId, executionVersion: current.executionVersion },
      expectedStatus: "paused",
      patch: taskPatchFor(current, "resume", {
        event: { type: "queued", message: "Maintenance task resumed and requeued" },
      }),
    });
    if (!resumed) return await this.store.readTask(taskId);
    await this.publishTask(resumed);
    this.scheduler.drain();
    return resumed;
  }

  async stop(taskId: string): Promise<MaintenanceTaskSnapshot> {
    let current = await this.store.readTask(taskId);
    if (["completed", "failed"].includes(current.status)) return current;
    let owner = { taskId, executionVersion: current.executionVersion };
    if (current.status === "paused") {
      const active = this.active.get(taskId);
      if (active?.owner.executionVersion === current.executionVersion) {
        active.executor.stop();
        await active.executor.waitForIdle();
        current = await this.store.readTask(taskId);
        owner = { taskId, executionVersion: current.executionVersion };
        if (["completed", "failed"].includes(current.status)) return current;
      }
    }
    const execution = await this.store.readExecution(taskId);
    if (execution.phase === "apply" && (current.status === "queued" || current.status === "paused")) {
      await this.skipPendingApplyItems(owner, STOPPED_ITEM);
    }
    const stopped = await this.store.transition({
      owner,
      expectedStatus: current.status,
      patch: taskPatchFor(current, "stop", {
        error: STOPPED,
        event: {
          type: current.status === "running" ? "stopping" : "failed",
          message: current.status === "running" ? "Stopping maintenance task" : STOPPED,
        },
      }),
    });
    if (!stopped) return await this.store.readTask(taskId);
    if (current.status === "running") this.active.get(taskId)?.executor.stop();
    await this.publishTask(stopped);
    if (stopped.status === "failed") await this.publish({ kind: "task-failed", taskId, error: STOPPED });
    return stopped;
  }

  async getTask(taskId: string): Promise<MaintenanceTaskSnapshot> {
    return await this.store.readTask(taskId);
  }

  async listTasks(): Promise<MaintenanceTaskSnapshot[]> {
    return await this.store.listTasks();
  }

  async listEvents(taskId: string) {
    return await this.store.listEvents(taskId);
  }

  async listApplyLogs(taskId: string) {
    return await this.store.listApplyLogs(taskId);
  }

  async waitForIdle(): Promise<void> {
    await this.scheduler.waitForIdle();
    await Promise.all([...this.active.values()].map((execution) => execution.executor.waitForIdle()));
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.scheduler.requestStop();
    for (const execution of this.active.values()) execution.executor.stop();
    await this.waitForIdle();
  }

  private async waitForApply(
    taskId: string,
    batchId: string,
    selectedIds: ReadonlySet<string>,
  ): Promise<MaintenanceApplyBatch> {
    for (;;) {
      const task = await this.store.readTask(taskId);
      if (task.status === "completed" || task.status === "failed") {
        const logs = await this.store.listApplyLogs(taskId);
        return {
          task,
          batchId,
          items: await this.store.listPreviews(taskId),
          applied: logs.filter((log) => log.batchId === batchId && selectedIds.has(log.previewId)),
        };
      }
      await this.waitForChange(taskId);
    }
  }

  private async runPreview(task: MaintenanceTaskSnapshot, persistedRefs: readonly MaintenanceTaskRef[]): Promise<void> {
    const owner = { taskId: task.id, executionVersion: task.executionVersion };
    const scanController = new AbortController();
    try {
      this.active.set(task.id, {
        owner,
        phase: "preview",
        executor: {
          pause: () => undefined,
          stop: () => scanController.abort(),
          waitForIdle: async () => undefined,
        },
      });
      const execution = await this.store.readExecution(task.id);
      const root = await this.roots.getActiveRoot(task.rootId);
      const refs = [...persistedRefs];
      const entries =
        refs.length > 0
          ? await this.scanExactRefs(root, refs, scanController.signal)
          : await this.runtime.scan({ root, signal: scanController.signal }).then(async (discovered) => {
              const sorted = [...discovered].sort((left, right) =>
                this.relativePath(root, left).localeCompare(this.relativePath(root, right), "zh-CN"),
              );
              const discoveredRefs = sorted.map((entry) => ({ relativePath: this.relativePath(root, entry) }));
              const persisted = await this.store.persistDiscoveredRefs(owner, discoveredRefs);
              if (!persisted) throw new Error("Maintenance execution ownership changed");
              return sorted;
            });
      const afterScan = await this.store.readTask(task.id);
      if (afterScan.executionVersion !== owner.executionVersion || afterScan.status === "paused") return;
      if (afterScan.status === "stopping") {
        if (!this.closing) await this.finishStopped(task.id, owner);
        return;
      }
      const alreadyCommitted = new Set((await this.store.listPreviews(task.id)).map((preview) => preview.relativePath));
      const pending = entries.filter((entry) => !alreadyCommitted.has(this.relativePath(root, entry)));
      const taskExecutor = new TaskExecutor<
        LocalScanEntry,
        {
          entry: LocalScanEntry;
          item: MaintenanceRuntimePreviewItem;
          librarySource: Awaited<ReturnType<MaintenanceLibraryPort["resolveSource"]>>;
        }
      >({
        concurrency: 1,
        gate: {
          beforeItem: async () => await this.assertOwned(owner, ["running"]),
          beforeResult: async () => await this.assertOwned(owner, ["running", "paused"]),
        },
        runItem: async (entry, context) => {
          try {
            const [item] = await this.runtime.previewEntries({
              root,
              presetId: execution.presetId,
              entries: [entry],
              signal: context.signal,
            });
            if (!item) throw new Error("维护预览未返回结果");
            const librarySource = this.library ? await this.library.resolveSource(entry.fileInfo.filePath) : null;
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
          const current = await this.store.readExecution(task.id);
          const preview = this.toPreview(task.id, execution.presetId, result.item, result.librarySource);
          const progress: MaintenanceTaskProgress = {
            totalEntries: current.totalEntries,
            completedEntries: current.completedEntries + 1,
            successCount: current.successCount + (preview.status === "ready" ? 1 : 0),
            failedCount: current.failedCount + (preview.status === "blocked" ? 1 : 0),
          };
          const committed = await this.store.commitPreviewItem(owner, { preview, progress });
          if (!committed) return;
          await this.publish({ kind: "preview-item", taskId: task.id, preview: committed, entry: result.entry });
          await this.publish({
            kind: "progress",
            taskId: task.id,
            phase: "preview",
            progress,
            message: committed.relativePath,
          });
        },
      });
      this.active.set(task.id, { owner, phase: "preview", executor: taskExecutor });
      const summary = await taskExecutor.execute(pending, owner.executionVersion);
      if (summary.outcome === "paused") return;
      if (summary.outcome === "stopped") {
        if (!this.closing) await this.finishStopped(task.id, owner);
        return;
      }
      const currentTask = await this.store.readTask(task.id);
      if (currentTask.status !== "running" || currentTask.executionVersion !== owner.executionVersion) return;
      const current = await this.store.readExecution(task.id);
      const allBlocked =
        current.totalEntries > 0 && current.successCount === 0 && current.failedCount >= current.totalEntries;
      const completed = await this.store.transition({
        owner,
        expectedStatus: "running",
        patch: taskPatchFor(currentTask, allBlocked ? "fail" : "complete", {
          error: allBlocked ? PREVIEW_ALL_FAILED : null,
          progress: current,
          event: {
            type: allBlocked ? "failed" : "completed",
            message: `Maintenance preview completed. Ready: ${current.successCount}, Blocked: ${current.failedCount}`,
          },
        }),
      });
      if (completed) {
        await this.publishTask(completed);
        if (allBlocked) await this.publish({ kind: "task-failed", taskId: task.id, error: PREVIEW_ALL_FAILED });
      }
    } catch (error) {
      if (this.closing) return;
      const current = await this.store.readTask(task.id).catch(() => null);
      if (!current || current.executionVersion !== owner.executionVersion || current.status === "paused") return;
      if (current.status === "stopping" || isAbortError(error)) {
        await this.finishStopped(task.id, owner);
        return;
      }
      await this.failTask(owner, toErrorMessage(error));
    } finally {
      if (this.active.get(task.id)?.owner.executionVersion === owner.executionVersion) this.active.delete(task.id);
      this.notify(task.id);
    }
  }

  private async runApply(task: MaintenanceTaskSnapshot): Promise<void> {
    const owner = { taskId: task.id, executionVersion: task.executionVersion };
    try {
      const execution = await this.store.readExecution(task.id);
      const root = await this.roots.getActiveRoot(task.rootId);
      const previews = new Map((await this.store.listPreviews(task.id)).map((preview) => [preview.id, preview]));
      const pending = await this.store.listPendingApplyItems(task.id);
      const taskExecutor = new TaskExecutor<MaintenanceTaskApplyQueueItem, MaintenanceApplyItemResult>({
        concurrency: 1,
        gate: {
          beforeItem: async () => await this.assertOwned(owner, ["running"]),
          beforeResult: async () => await this.assertOwned(owner, ["running", "paused", "stopping"]),
        },
        runItem: async (item, context) => {
          const marked = await this.store.markApplyItemProcessing(owner, item.id);
          if (!marked) throw new Error("Maintenance execution ownership changed");
          const preview = previews.get(item.previewId);
          if (!preview) return { status: "failed", error: "维护预览不存在" };
          if (preview.status === "blocked") {
            return { status: "skipped", error: preview.error ?? "维护预览不可应用" };
          }
          try {
            const [entry] = await this.scanExactRefs(root, [{ relativePath: preview.relativePath }], context.signal);
            if (!entry) return { status: "failed", error: `维护文件不存在：${preview.relativePath}` };
            const committed = buildMaintenanceApplyCommit(entry, preview, item.fieldSelections);
            const sourceAbsolutePath = preview.entry?.fileInfo.filePath ?? entry.fileInfo.filePath;
            const targetAbsolutePath = preview.pathDiff?.targetVideoPath ?? sourceAbsolutePath;
            await this.library.preflightRefresh({
              librarySource: preview.librarySource,
              sourceAbsolutePath,
              targetAbsolutePath,
            });
            const applied = await this.runtime.applyEntry({
              root,
              presetId: execution.presetId,
              entry,
              committed,
              progress: {
                fileIndex: Math.min(execution.totalEntries, execution.completedEntries + 1),
                totalFiles: execution.totalEntries,
              },
              signal: context.signal,
            });
            if (applied.status === "failed") return { status: "failed", error: applied.error };
            const outputRelativePath = applied.outputRelativePath || preview.relativePath;
            let file: Awaited<ReturnType<typeof stat>>;
            try {
              file = await stat(applied.entry.fileInfo.filePath);
              await this.library.commitRefresh({
                librarySource: preview.librarySource,
                sourceAbsolutePath,
                targetAbsolutePath: applied.entry.fileInfo.filePath,
                size: file.size,
                modifiedAt: file.mtime,
                crawlerData: applied.crawlerData ?? applied.entry.crawlerData ?? committed.crawlerData,
                fallbackNumber: applied.entry.fileInfo.number,
                assets: applied.entry.assets,
                refreshedAt: new Date(),
              });
            } catch (error) {
              return {
                status: "failed",
                error: `文件操作已完成，但媒体库提交失败：${toErrorMessage(error)}。请重新扫描并预览，以磁盘实际状态重新协调。`,
              };
            }
            return {
              status: "success",
              entry: applied.entry,
              crawlerData: applied.crawlerData ?? committed.crawlerData,
              fieldDiffs: applied.fieldDiffs,
              unchangedFieldDiffs: applied.unchangedFieldDiffs,
              pathDiff: applied.pathDiff,
              outputRelativePath,
              outputSize: file.size,
              outputModifiedAt: file.mtime,
            };
          } catch (error) {
            return {
              status: isAbortError(error) || context.signal.aborted ? "skipped" : "failed",
              error: isAbortError(error) || context.signal.aborted ? STOPPED_ITEM : toErrorMessage(error),
            };
          }
        },
        applyResult: async (item, result) => {
          const log = await this.store.commitApplyItem(owner, item.id, result);
          if (!log) return;
          await this.publish({ kind: "apply-item", taskId: task.id, log, result });
          const progress = await this.store.readExecution(task.id);
          await this.publish({
            kind: "progress",
            taskId: task.id,
            phase: "apply",
            progress,
            message: log.relativePath,
          });
        },
      });
      this.active.set(task.id, { owner, phase: "apply", executor: taskExecutor });
      const summary = await taskExecutor.execute(pending, owner.executionVersion);
      if (summary.outcome === "paused") return;
      if (summary.outcome === "stopped") {
        if (this.closing) {
          const failed = await this.store.failInterruptedApply(owner, INTERRUPTED_APPLY);
          if (failed) {
            await this.publishTask(failed);
            await this.publish({ kind: "task-failed", taskId: task.id, error: INTERRUPTED_APPLY });
          }
        } else {
          await this.skipPendingApplyItems(owner, STOPPED_ITEM);
          await this.finishStopped(task.id, owner);
        }
        return;
      }
      const currentTask = await this.store.readTask(task.id);
      if (currentTask.status !== "running" || currentTask.executionVersion !== owner.executionVersion) return;
      const progress = await this.store.readExecution(task.id);
      const failedAll = progress.successCount === 0 && progress.failedCount >= progress.totalEntries;
      const completed = await this.store.transition({
        owner,
        expectedStatus: "running",
        patch: taskPatchFor(currentTask, failedAll ? "fail" : "complete", {
          error: failedAll ? APPLY_FAILED : null,
          progress,
          event: {
            type: failedAll ? "failed" : "completed",
            message: `Maintenance completed. Succeeded: ${progress.successCount}, Failed: ${progress.failedCount}`,
          },
        }),
      });
      if (completed) {
        await this.publishTask(completed);
        if (failedAll) await this.publish({ kind: "task-failed", taskId: task.id, error: APPLY_FAILED });
      }
    } catch (error) {
      if (this.closing) {
        const failed = await this.store.failInterruptedApply(owner, INTERRUPTED_APPLY);
        if (failed) await this.publishTask(failed);
      } else {
        await this.failTask(owner, toErrorMessage(error));
      }
    } finally {
      if (this.active.get(task.id)?.owner.executionVersion === owner.executionVersion) this.active.delete(task.id);
      this.notify(task.id);
    }
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
    taskId: string,
    presetId: MaintenancePresetId,
    item: MaintenanceRuntimePreviewItem,
    librarySource: Awaited<ReturnType<MaintenanceLibraryPort["resolveSource"]>>,
  ): MaintenanceTaskPreview {
    const now = new Date();
    return {
      id: randomUUID(),
      taskId,
      rootId: item.rootId,
      relativePath: item.relativePath,
      presetId,
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

  private async skipPendingApplyItems(owner: MaintenanceExecutionOwner, error: string): Promise<void> {
    for (const item of await this.store.listPendingApplyItems(owner.taskId)) {
      const result: MaintenanceApplyItemResult = { status: "skipped", error };
      const log = await this.store.commitApplyItem(owner, item.id, result);
      if (log) await this.publish({ kind: "apply-item", taskId: owner.taskId, log, result });
    }
  }

  private async finishStopped(taskId: string, owner: MaintenanceExecutionOwner): Promise<void> {
    const current = await this.store.readTask(taskId);
    if (current.status !== "stopping" || current.executionVersion !== owner.executionVersion) return;
    const failed = await this.store.transition({
      owner,
      expectedStatus: "stopping",
      patch: taskPatchFor(current, "fail", {
        error: STOPPED,
        event: { type: "failed", message: STOPPED },
      }),
    });
    if (failed) {
      await this.publishTask(failed);
      await this.publish({ kind: "task-failed", taskId, error: STOPPED });
    }
  }

  private async failTask(owner: MaintenanceExecutionOwner, error: string): Promise<void> {
    const current = await this.store.readTask(owner.taskId);
    if (current.executionVersion !== owner.executionVersion || ["completed", "failed"].includes(current.status)) return;
    const failed = await this.store.transition({
      owner,
      expectedStatus: current.status,
      patch: taskPatchFor(current, "fail", { error, event: { type: "failed", message: error } }),
    });
    if (failed) {
      await this.publishTask(failed);
      await this.publish({ kind: "task-failed", taskId: owner.taskId, error });
    }
  }

  private async assertOwned(owner: MaintenanceExecutionOwner, statuses: readonly MaintenanceTaskStatus[]) {
    const task = await this.store.readTask(owner.taskId);
    if (task.executionVersion !== owner.executionVersion || !statuses.includes(task.status)) {
      throw new Error("Maintenance execution ownership changed");
    }
  }

  private assertUniqueRefs(refs: readonly MaintenanceTaskRef[]): void {
    const seen = new Set<string>();
    for (const ref of refs) {
      if (!ref.relativePath.trim()) throw new Error("维护文件相对路径不能为空");
      if (seen.has(ref.relativePath)) throw new Error(`维护文件路径重复：${ref.relativePath}`);
      seen.add(ref.relativePath);
    }
  }

  private async publishTask(task: MaintenanceTaskSnapshot): Promise<void> {
    await this.publish({ kind: "task-changed", task });
    const events = await this.store.listEvents(task.id);
    const event = events.at(-1);
    if (event) await this.publish({ kind: "log", taskId: task.id, event });
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

  private assertOpen(): void {
    if (this.closing) throw new Error("Maintenance coordinator is closed");
  }
}
