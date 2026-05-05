import { maintenancePreviewDtoToPreviewItem, scrapeResultDtoToScrapeResult } from "./dtoAdapters";
import type {
  AmbiguousUncensoredItemDto,
  MaintenancePreviewResponse,
  ScanTaskDto,
  ScrapeResultListResponse,
  WebTaskUpdateDto,
} from "./serverDtos";
import { useMaintenanceExecutionStore } from "./stores/maintenanceExecutionStore";
import { applyMaintenancePreviewResult } from "./stores/maintenanceSession";
import { useScrapeStore } from "./stores/scrapeStore";
import type { MaintenancePreviewItem } from "./types";

export interface TaskHydrationState {
  activeScrapeTaskId: string;
  activeMaintenanceTaskId: string;
  uncensoredTaskId: string;
  ambiguousUncensoredItems: AmbiguousUncensoredItemDto[];
  shouldOpenUncensoredDialog: boolean;
}

export const createTaskHydrationState = (): TaskHydrationState => ({
  activeScrapeTaskId: "",
  activeMaintenanceTaskId: "",
  uncensoredTaskId: "",
  ambiguousUncensoredItems: [],
  shouldOpenUncensoredDialog: false,
});

const taskStatusToScrapeStatus = (
  status: ScanTaskDto["status"],
): ReturnType<typeof useScrapeStore.getState>["scrapeStatus"] => {
  if (status === "running" || status === "queued") return "running";
  if (status === "paused") return "paused";
  if (status === "stopping") return "stopping";
  return "idle";
};

const taskStatusToMaintenanceStatus = (
  status: ScanTaskDto["status"],
): ReturnType<typeof useMaintenanceExecutionStore.getState>["executionStatus"] => {
  if (status === "running" || status === "queued") return "previewing";
  if (status === "paused") return "paused";
  if (status === "stopping") return "stopping";
  return "idle";
};

export const hydrateScrapeResults = (response: ScrapeResultListResponse): void => {
  const store = useScrapeStore.getState();
  store.clearResults();
  for (const result of response.results.map(scrapeResultDtoToScrapeResult)) {
    store.addResult(result);
  }
};

export const hydrateMaintenancePreview = (response: MaintenancePreviewResponse): MaintenancePreviewItem[] => {
  const items = response.items.map(maintenancePreviewDtoToPreviewItem);
  applyMaintenancePreviewResult({ items });
  return items;
};

export const applyWebTaskUpdate = (payload: WebTaskUpdateDto, previous: TaskHydrationState): TaskHydrationState => {
  const next = { ...previous, shouldOpenUncensoredDialog: false };

  if (payload.kind === "snapshot") {
    for (const task of payload.tasks) {
      if (task.kind === "scrape" && task.status !== "completed" && task.status !== "failed") {
        next.activeScrapeTaskId = task.id;
      }
      if (task.kind === "maintenance" && task.status !== "completed" && task.status !== "failed") {
        next.activeMaintenanceTaskId = task.id;
      }
    }
    return next;
  }

  if (payload.kind === "task") {
    if (payload.task.kind === "scrape") {
      next.activeScrapeTaskId = payload.task.id;
      const scrapeStatus = taskStatusToScrapeStatus(payload.task.status);
      const store = useScrapeStore.getState();
      store.setScrapeStatus(scrapeStatus);
      store.setScraping(scrapeStatus === "running" || scrapeStatus === "paused" || scrapeStatus === "stopping");
      store.updateProgress(payload.task.videoCount, payload.task.videos?.length ?? payload.task.videoCount);
    }

    if (payload.task.kind === "maintenance") {
      next.activeMaintenanceTaskId = payload.task.id;
      useMaintenanceExecutionStore.getState().setExecutionStatus(taskStatusToMaintenanceStatus(payload.task.status));
    }

    return next;
  }

  if (payload.kind === "event" && payload.event.type === "completed" && payload.ambiguousUncensoredItems?.length) {
    next.uncensoredTaskId = payload.event.taskId;
    next.ambiguousUncensoredItems = payload.ambiguousUncensoredItems;
    next.shouldOpenUncensoredDialog = true;
  }

  return next;
};
