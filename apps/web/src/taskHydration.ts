import { scrapeAssetReferencesToResult } from "@mdcz/shared/dtoAdapters";
import type {
  ScrapeLiveItemDto,
  ScrapeLiveRunSnapshotDto,
  ScrapePendingUncensoredConfirmationResponse,
} from "@mdcz/shared/serverDtos";
import type { ScrapeResult } from "@mdcz/shared/types";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import type { TaskHydrationState } from "@mdcz/views/state/workbenchTaskStore";

export type { TaskHydrationState } from "@mdcz/views/state/workbenchTaskStore";

const liveTaskStatusToScrapeStatus = (
  status: ScrapeLiveRunSnapshotDto["task"]["status"],
): ReturnType<typeof useScrapeStore.getState>["scrapeStatus"] => {
  if (status === "paused") return "paused";
  if (status === "stopping") return "stopping";
  return "running";
};

const liveItemToScrapeResult = (item: ScrapeLiveItemDto): ScrapeResult => ({
  ...(item.resultId ? { resultId: item.resultId } : {}),
  fileId: `${item.rootId}:${item.relativePath}`,
  fileInfo: {
    filePath: item.relativePath,
    fileName: item.fileName,
    extension: item.fileName.split(".").pop() ?? "",
    number: item.crawlerData?.number ?? item.fileName.replace(/\.[^.]+$/u, ""),
    isSubtitled: false,
  },
  status: item.status,
  ...(item.crawlerData ? { crawlerData: item.crawlerData } : {}),
  ...(item.error ? { error: item.error } : {}),
  ...(item.outputRelativePath ? { outputPath: item.outputRelativePath } : {}),
  ...(item.nfoRootId ? { nfoRootId: item.nfoRootId } : {}),
  ...(item.nfoRelativePath ? { nfoPath: item.nfoRelativePath } : {}),
  ...scrapeAssetReferencesToResult(item),
  uncensoredAmbiguous: item.uncensoredAmbiguous,
});

export const selectActiveLiveScrapeRun = (
  runs: ScrapeLiveRunSnapshotDto[],
  previousActiveRunId: string,
): ScrapeLiveRunSnapshotDto | null => {
  const retained = runs.find((run) => run.task.id === previousActiveRunId);
  if (retained) return retained;

  const running = runs.find((run) => run.task.status === "running");
  if (running) return running;

  return (
    runs
      .filter((run) => run.task.status === "queued" || run.task.status === "paused")
      .sort((left, right) => right.task.createdAt.localeCompare(left.task.createdAt))[0] ?? null
  );
};

/**
 * Applies one complete `scrape.liveRuns()` response.  No SSE payload and no
 * mutation acknowledgement can enter the live scrape stores directly.
 */
export const applyScrapeLiveRunsSnapshot = (
  runs: ScrapeLiveRunSnapshotDto[],
  previous: TaskHydrationState,
): TaskHydrationState => {
  const liveScrapeRunsById = Object.fromEntries(runs.map((run) => [run.task.id, run])) as Record<
    string,
    ScrapeLiveRunSnapshotDto
  >;
  const selected = selectActiveLiveScrapeRun(runs, previous.activeScrapeTaskId);
  const scrapeStore = useScrapeStore.getState();
  const uiStore = useUIStore.getState();

  if (!selected) {
    scrapeStore.replaceResults([]);
    scrapeStore.updateProgress(0, 0);
    scrapeStore.setScrapeStatus("idle");
    scrapeStore.setScraping(false);
    if (uiStore.selectedResultId) uiStore.setSelectedResultId(null);
    return {
      ...previous,
      activeScrapeTaskId: "",
      liveScrapeRunsById,
      latestScrapeStage: null,
    };
  }

  const results = selected.items.map(liveItemToScrapeResult);
  scrapeStore.replaceResults(results);
  scrapeStore.updateProgress(selected.progress.completedItems, selected.progress.totalItems, selected.progress.percent);
  scrapeStore.setScrapeStatus(liveTaskStatusToScrapeStatus(selected.task.status));
  scrapeStore.setScraping(true);
  if (uiStore.selectedResultId && !results.some((result) => result.fileId === uiStore.selectedResultId)) {
    uiStore.setSelectedResultId(null);
  }

  return {
    ...previous,
    activeScrapeTaskId: selected.task.id,
    liveScrapeRunsById,
    latestScrapeStage: selected.latestStage
      ? {
          taskId: selected.task.id,
          stage: selected.latestStage.stage,
          message: selected.latestStage.message,
          ...(selected.latestStage.relativePath ? { relativePath: selected.latestStage.relativePath } : {}),
        }
      : null,
  };
};

export const applyPendingUncensoredConfirmation = (
  response: ScrapePendingUncensoredConfirmationResponse,
  previous: TaskHydrationState,
): TaskHydrationState => {
  const byTask = new Map<string, typeof response.items>();
  for (const item of response.items) {
    const items = byTask.get(item.taskId) ?? [];
    items.push(item);
    byTask.set(item.taskId, items);
  }
  const taskId =
    (previous.uncensoredTaskId && byTask.has(previous.uncensoredTaskId) ? previous.uncensoredTaskId : "") ||
    (previous.activeScrapeTaskId && byTask.has(previous.activeScrapeTaskId) ? previous.activeScrapeTaskId : "") ||
    response.items[0]?.taskId ||
    "";
  const items = taskId ? (byTask.get(taskId) ?? []) : [];
  return {
    ...previous,
    shouldOpenUncensoredDialog: items.length > 0,
    uncensoredTaskId: taskId,
    ambiguousUncensoredItems: items.map(({ taskId: _taskId, ...item }) => item),
  };
};
