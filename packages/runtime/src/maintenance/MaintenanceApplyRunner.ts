import { stat } from "node:fs/promises";
import { buildMaintenanceApplyCommit } from "@mdcz/shared/maintenanceCommit";
import type { MaintenanceApplyItemResult } from "@mdcz/shared/maintenanceTasks";
import { isAbortError } from "../scrape/utils/abort";
import { TaskExecutor } from "../tasks";
import {
  type MaintenanceRunnerDependencies,
  scanMaintenanceRefs,
  toMaintenanceErrorMessage,
} from "./MaintenanceExecution";
import {
  APPLY_FAILED,
  type MaintenanceCurrentBatchItem,
  OWNERSHIP_CHANGED,
  STOPPED_ITEM,
} from "./MaintenanceSessionState";

type MaintenanceApplyExecutionResult = {
  result: MaintenanceApplyItemResult;
  libraryCommit?: Parameters<MaintenanceRunnerDependencies["library"]["commitRefresh"]>[0];
};

const libraryCommitFailure = (error: unknown): MaintenanceApplyItemResult => ({
  status: "failed",
  error: `文件操作已完成，但媒体库提交失败：${toMaintenanceErrorMessage(error)}。请重新扫描并预览，以磁盘实际状态重新协调。`,
});

/** Runs selected maintenance updates and records their terminal results. */
export class MaintenanceApplyRunner {
  constructor(private readonly deps: MaintenanceRunnerDependencies) {}

  async run(sessionId: string, generation: number): Promise<void> {
    try {
      const initial = this.deps.sessions.assertCurrent(sessionId, generation, ["running"]);
      const root = await this.deps.roots.getActiveRoot(initial.rootId);
      const pending = this.deps.sessions.pendingBatchItems(initial);
      const executor = new TaskExecutor<MaintenanceCurrentBatchItem, MaintenanceApplyExecutionResult>({
        concurrency: 1,
        gate: {
          beforeItem: async () => {
            this.deps.sessions.assertCurrent(sessionId, generation, ["running"]);
          },
          beforeResult: async () => {
            this.deps.sessions.assertCurrent(sessionId, generation, ["running", "paused"]);
          },
        },
        runItem: async (item, context) => {
          const active = this.deps.sessions.markApplyProcessing(sessionId, generation, item);
          if (!active.preview) return { result: { status: "failed", error: "维护预览不存在" } };
          if (active.preview.status === "blocked") {
            return { result: { status: "skipped", error: active.preview.error ?? "维护预览不可应用" } };
          }
          try {
            const [entry] = await scanMaintenanceRefs(
              this.deps.runtime,
              root,
              [{ relativePath: active.preview.relativePath }],
              context.signal,
            );
            if (!entry) {
              return { result: { status: "failed", error: `维护文件不存在：${active.preview.relativePath}` } };
            }
            const committed = buildMaintenanceApplyCommit(entry, active.preview, active.item.selection.fieldSelections);
            const sourceAbsolutePath = active.preview.entry?.fileInfo.filePath ?? entry.fileInfo.filePath;
            const targetAbsolutePath = active.preview.pathDiff?.targetVideoPath ?? sourceAbsolutePath;
            await this.deps.library.preflightRefresh({
              librarySource: active.preview.librarySource,
              sourceAbsolutePath,
              targetAbsolutePath,
            });
            const latest = this.deps.sessions.assertCurrent(sessionId, generation, ["running", "paused"]);
            const applied = await this.deps.runtime.applyEntry({
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
            const outputRelativePath = applied.outputRelativePath || active.preview.relativePath;
            let file: Awaited<ReturnType<typeof stat>>;
            try {
              file = await stat(applied.entry.fileInfo.filePath);
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
              libraryCommit: {
                librarySource: active.preview.librarySource,
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
                error: isAbortError(error) || context.signal.aborted ? STOPPED_ITEM : toMaintenanceErrorMessage(error),
              },
            };
          }
        },
        applyResult: async (item, executionResult) => {
          let result = executionResult.result;
          if (executionResult.libraryCommit) {
            try {
              this.deps.sessions.assertCurrent(sessionId, generation, ["running", "paused"]);
              await this.deps.library.commitRefresh(executionResult.libraryCommit);
            } catch (error) {
              if (!this.deps.sessions.isCurrent(sessionId, generation)) throw error;
              result = libraryCommitFailure(error);
            }
          }
          await this.commitItem(sessionId, generation, item, result);
        },
      });
      this.deps.activate({ sessionId, generation, phase: "apply", executor });
      const summary = await executor.execute(pending, generation);
      if (summary.outcome === "paused" || summary.outcome === "stopped") return;
      const current = this.deps.sessions.assertCurrent(sessionId, generation, ["running"]);
      const failedAll =
        current.progress.totalEntries > 0 &&
        current.progress.successCount === 0 &&
        current.progress.failedCount >= current.progress.totalEntries;
      await this.deps.finish(
        sessionId,
        generation,
        failedAll ? "failed" : "completed",
        failedAll ? APPLY_FAILED : null,
      );
    } catch (error) {
      if (!this.deps.sessions.isCurrent(sessionId, generation) || this.deps.isClosing()) return;
      const current = this.deps.sessions.require(sessionId);
      if (current.status === "paused") return;
      if (
        isAbortError(error) ||
        current.status === "stopping" ||
        toMaintenanceErrorMessage(error) === OWNERSHIP_CHANGED
      ) {
        return;
      }
      const message = toMaintenanceErrorMessage(error);
      await this.skipOutstanding(sessionId, generation, message);
      await this.deps.fail(sessionId, generation, message);
    } finally {
      this.deps.deactivate(sessionId, generation);
      this.deps.notify(sessionId);
    }
  }

  async skipOutstanding(sessionId: string, generation: number, error: string): Promise<void> {
    const session = this.deps.sessions.assertCurrent(sessionId, generation, ["running", "paused", "stopping"]);
    for (const item of this.deps.sessions.pendingOrProcessingBatchItems(session)) {
      await this.commitItem(sessionId, generation, item, { status: "skipped", error });
    }
  }

  private async commitItem(
    sessionId: string,
    generation: number,
    item: MaintenanceCurrentBatchItem,
    result: MaintenanceApplyItemResult,
  ): Promise<void> {
    const committed = this.deps.sessions.commitApplyItem(sessionId, generation, item, result);
    if (!committed) return;
    await this.deps.projector.applyItem(committed.session, committed.item, committed.preview, result);
  }
}
