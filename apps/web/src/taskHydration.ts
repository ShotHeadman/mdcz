import type { ScrapePendingUncensoredConfirmationResponse, ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";
import { selectScrapeResults, selectScrapeTaskId, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import type { TaskHydrationState } from "@mdcz/views/state/workbenchTaskStore";

export type { TaskHydrationState } from "@mdcz/views/state/workbenchTaskStore";

export const selectActiveLiveScrapeRun = (
  runs: ScrapeRunSnapshotDto[],
  previousActiveRunId: string,
): ScrapeRunSnapshotDto | null => {
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
export const applyScrapeLiveRunsSnapshot = (runs: ScrapeRunSnapshotDto[]): void => {
  const selected = selectActiveLiveScrapeRun(runs, selectScrapeTaskId(useScrapeStore.getState()));
  if (!selected) return;

  const scrapeStore = useScrapeStore.getState();
  scrapeStore.setSnapshot(selected);
  const results = selectScrapeResults(useScrapeStore.getState());
  const uiStore = useUIStore.getState();
  if (uiStore.selectedResultId && !results.some((result) => result.fileId === uiStore.selectedResultId)) {
    uiStore.setSelectedResultId(null);
  }
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
  const scrapeTaskId = selectScrapeTaskId(useScrapeStore.getState());
  const taskId =
    (previous.uncensoredTaskId && byTask.has(previous.uncensoredTaskId) ? previous.uncensoredTaskId : "") ||
    (scrapeTaskId && byTask.has(scrapeTaskId) ? scrapeTaskId : "") ||
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
