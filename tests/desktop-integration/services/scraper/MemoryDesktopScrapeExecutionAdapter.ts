import type {
  CreatedDesktopScrapeRun,
  DesktopScrapeExecutionAdapter,
} from "@main/services/scraper/DesktopScrapeExecutionStore";
import type { MediaRoot } from "@mdcz/media-store";
import type { ScrapeRunSummaryRecord } from "@mdcz/persistence";
import type { ScrapeRunItem } from "@mdcz/runtime/tasks";
import type { ScrapeResult } from "@mdcz/shared/types";

export class MemoryDesktopScrapeExecutionAdapter implements DesktopScrapeExecutionAdapter {
  readonly committed: Array<{ runId: string; item: ScrapeRunItem; result: ScrapeResult }> = [];
  readonly finalized: ScrapeRunSummaryRecord[] = [];
  private nextRun = 1;

  async createRun(
    files: readonly string[],
    executionMode: "single" | "batch",
    requestedOutputRoot: MediaRoot | null,
  ): Promise<CreatedDesktopScrapeRun> {
    const runId = `run-${this.nextRun}`;
    this.nextRun += 1;
    const createdAt = new Date();
    const manifestItems = files.map((sourcePath, ordinal) => ({
      id: `${runId}:item-${ordinal + 1}`,
      runId,
      ordinal,
      rootId: "desktop-input",
      relativePath: sourcePath,
      manualUrl: null,
      uncensoredChoice: null,
    }));
    return {
      manifest: {
        id: runId,
        rootId: "desktop-input",
        outputRootId: requestedOutputRoot?.id ?? null,
        executionMode,
        createdAt,
        items: manifestItems,
      },
      items: manifestItems.map((item, index) => ({
        id: item.id,
        rootId: item.rootId,
        relativePath: item.relativePath,
        sourcePath: files[index],
        attempt: 1,
      })),
    };
  }

  async commitItem(runId: string, item: ScrapeRunItem, result: ScrapeResult): Promise<ScrapeResult> {
    const committed = { ...result, resultId: `${item.id}:attempt-${item.attempt}` };
    this.committed.push({ runId, item: { ...item }, result: committed });
    return committed;
  }

  async finalizeRun(
    runId: string,
    disposition: "completed" | "failed" | "stopped",
    options: { error?: string | null; startedAt?: Date | null } = {},
  ): Promise<ScrapeRunSummaryRecord> {
    const latest = new Map<string, ScrapeResult>();
    for (const committed of this.committed) {
      if (committed.runId === runId) latest.set(committed.item.id, committed.result);
    }
    const results = [...latest.values()];
    const summary: ScrapeRunSummaryRecord = {
      runId,
      disposition,
      startedAt: options.startedAt ?? null,
      completedAt: new Date(),
      successCount: results.filter((result) => result.status === "success").length,
      failedCount: results.filter((result) => result.status === "failed").length,
      skippedCount: results.filter((result) => result.status === "skipped").length,
      totalBytes: 0,
      outputRootId: null,
      outputDirectory: null,
      error: options.error ?? null,
    };
    this.finalized.push(summary);
    return summary;
  }
}
