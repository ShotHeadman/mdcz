import type { ScrapePendingUncensoredConfirmationResponse, ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";
import {
  selectIsScraping,
  selectScrapeResults,
  selectScrapeTaskId,
  useScrapeStore,
} from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import type { TaskHydrationState } from "@mdcz/views/state/workbenchTaskStore";
import { api } from "./client";

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

export const readScrapeRunsSnapshot = async () => {
  const response = await api.scrape.liveRuns();
  const state = useScrapeStore.getState();
  const taskId = selectScrapeTaskId(state);
  if (taskId && selectIsScraping(state) && !response.runs.some((run) => run.task.id === taskId)) {
    response.runs.push(await api.scrape.snapshot({ taskId }));
  }
  return response;
};

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
  return {
    ...previous,
    shouldOpenUncensoredDialog: response.items.length > 0,
    ambiguousUncensoredItems: response.items,
  };
};
