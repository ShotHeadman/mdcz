import type { LocalScanEntry } from "@mdcz/shared/types";
import { isAbortError } from "../scrape/utils/abort";
import { TaskExecutor } from "../tasks";
import type { MaintenanceLibraryPort } from "./coordinatorContracts";
import {
  type MaintenanceRunnerDependencies,
  maintenanceRelativePath,
  scanMaintenanceRefs,
  toMaintenanceErrorMessage,
} from "./MaintenanceExecution";
import type { MaintenanceRuntimePreviewItem } from "./MaintenanceRuntime";
import { OWNERSHIP_CHANGED, PREVIEW_ALL_FAILED } from "./MaintenanceSessionState";

type PreviewExecutionResult = {
  entry: LocalScanEntry;
  item: MaintenanceRuntimePreviewItem;
  librarySource: Awaited<ReturnType<MaintenanceLibraryPort["resolveSource"]>>;
};

/** Runs the scan and per-file preview work for one maintenance session. */
export class MaintenancePreviewRunner {
  constructor(private readonly deps: MaintenanceRunnerDependencies) {}

  async run(sessionId: string, generation: number): Promise<void> {
    const scanController = new AbortController();
    this.deps.activate({
      sessionId,
      generation,
      phase: "preview",
      executor: {
        pause: () => undefined,
        stop: () => scanController.abort(),
      },
    });
    try {
      const initial = this.deps.sessions.assertCurrent(sessionId, generation, ["running"]);
      const root = await this.deps.roots.getActiveRoot(initial.rootId);
      const persistedRefs = [...initial.refs];
      const entries =
        persistedRefs.length > 0
          ? await scanMaintenanceRefs(this.deps.runtime, root, persistedRefs, scanController.signal)
          : [...(await this.deps.runtime.scan({ root, signal: scanController.signal }))].sort((left, right) =>
              maintenanceRelativePath(root, left).localeCompare(maintenanceRelativePath(root, right), "zh-CN"),
            );

      let current = this.deps.sessions.assertCurrent(sessionId, generation, ["running", "paused"]);
      if (persistedRefs.length === 0) {
        current = this.deps.sessions.replaceScannedRefs(
          sessionId,
          generation,
          entries.map((entry) => ({ relativePath: maintenanceRelativePath(root, entry) })),
        );
      }
      if (current.status === "paused") return;

      const committedPaths = new Set([...current.previews.values()].map((preview) => preview.relativePath));
      const pending = entries.filter((entry) => !committedPaths.has(maintenanceRelativePath(root, entry)));
      const executor = new TaskExecutor<LocalScanEntry, PreviewExecutionResult>({
        concurrency: 1,
        gate: {
          beforeItem: async () => {
            this.deps.sessions.assertCurrent(sessionId, generation, ["running"]);
          },
          beforeResult: async () => {
            this.deps.sessions.assertCurrent(sessionId, generation, ["running", "paused"]);
          },
        },
        runItem: async (entry, context) => {
          try {
            const active = this.deps.sessions.assertCurrent(sessionId, generation, ["running"]);
            const [item] = await this.deps.runtime.previewEntries({
              root,
              presetId: active.presetId,
              entries: [entry],
              signal: context.signal,
            });
            if (!item) throw new Error("维护预览未返回结果");
            const librarySource = await this.deps.library.resolveSource(entry.fileInfo.filePath);
            return { entry, item, librarySource };
          } catch (error) {
            if (isAbortError(error) || context.signal.aborted) throw error;
            return {
              entry,
              item: {
                entry,
                rootId: root.id,
                relativePath: maintenanceRelativePath(root, entry),
                status: "blocked",
                error: toMaintenanceErrorMessage(error),
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
          const committed = this.deps.sessions.commitPreview(sessionId, generation, result.item, result.librarySource);
          await this.deps.projector.previewItem(committed.session, committed.preview, result.entry);
        },
      });
      this.deps.activate({ sessionId, generation, phase: "preview", executor });
      const summary = await executor.execute(pending, generation);
      if (summary.outcome === "paused" || summary.outcome === "stopped") return;
      current = this.deps.sessions.assertCurrent(sessionId, generation, ["running"]);
      const allBlocked =
        current.progress.totalEntries > 0 &&
        current.progress.successCount === 0 &&
        current.progress.failedCount >= current.progress.totalEntries;
      await this.deps.finish(
        sessionId,
        generation,
        allBlocked ? "failed" : "completed",
        allBlocked ? PREVIEW_ALL_FAILED : null,
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
      await this.deps.fail(sessionId, generation, toMaintenanceErrorMessage(error));
    } finally {
      this.deps.deactivate(sessionId, generation);
      this.deps.notify(sessionId);
    }
  }
}
