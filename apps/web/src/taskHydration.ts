import { maintenancePreviewDtoToPreviewItem, scrapeResultDtoToScrapeResult } from "@mdcz/shared/dtoAdapters";
import type {
  MaintenanceApplyLogDto,
  MaintenancePreviewResponse,
  ScanTaskDto,
  ScrapeResultListResponse,
  TaskRealtimeEventDto,
  WebTaskUpdateDto,
} from "@mdcz/shared/serverDtos";
import { useMaintenanceExecutionStore } from "@mdcz/shared/stores/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@mdcz/shared/stores/maintenancePreviewStore";
import {
  applyMaintenanceExecutionItemResult,
  applyMaintenancePreviewResult,
} from "@mdcz/shared/stores/maintenanceSession";
import { useScrapeStore } from "@mdcz/shared/stores/scrapeStore";
import { useUIStore } from "@mdcz/shared/stores/uiStore";
import type { TaskHydrationState } from "@mdcz/shared/stores/workbenchTaskStore";
import type { MaintenancePreviewItem } from "@mdcz/shared/types";

export type { TaskHydrationState } from "@mdcz/shared/stores/workbenchTaskStore";

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

const isActiveTaskStatus = (status: ScanTaskDto["status"]): boolean =>
  status === "queued" || status === "running" || status === "paused" || status === "stopping";

export const hydrateScrapeResults = (response: ScrapeResultListResponse): void => {
  const store = useScrapeStore.getState();
  store.clearResults();
  for (const result of response.results.map(scrapeResultDtoToScrapeResult)) {
    store.addResult(result);
  }
};

export const selectWorkbenchScrapeResults = (
  response: ScrapeResultListResponse,
  activeTaskId: string,
): { taskId: string; results: ScrapeResultListResponse["results"] } => {
  const preferredTaskId = activeTaskId.trim();
  const preferredResults = preferredTaskId
    ? response.results.filter((result) => result.taskId === preferredTaskId)
    : [];

  if (preferredTaskId) {
    return { taskId: preferredTaskId, results: preferredResults };
  }

  return { taskId: "", results: [] };
};

export const hydrateWorkbenchScrapeResults = (
  response: ScrapeResultListResponse,
  previous: TaskHydrationState,
): TaskHydrationState => {
  const selection = selectWorkbenchScrapeResults(response, previous.activeScrapeTaskId);
  const projectedResults = selection.results.map(scrapeResultDtoToScrapeResult);
  const scrapeStore = useScrapeStore.getState();
  scrapeStore.clearResults();
  for (const result of projectedResults) {
    scrapeStore.addResult(result);
  }

  const uiStore = useUIStore.getState();
  if (uiStore.selectedResultId && !projectedResults.some((result) => result.fileId === uiStore.selectedResultId)) {
    uiStore.setSelectedResultId(null);
  }

  return selection.taskId ? { ...previous, activeScrapeTaskId: selection.taskId } : previous;
};

const applyScrapeTaskSnapshot = (task: ScanTaskDto): void => {
  const scrapeStatus = taskStatusToScrapeStatus(task.status);
  const store = useScrapeStore.getState();
  const total = task.videos?.length ?? task.videoCount;
  const isTerminal = task.status === "completed" || task.status === "failed";
  const current = isTerminal && total > 0 ? total : Math.min(task.videoCount, total);
  store.setScrapeStatus(scrapeStatus);
  store.setScraping(scrapeStatus === "running" || scrapeStatus === "paused" || scrapeStatus === "stopping");
  const snapshotProgress = total > 0 ? (current / total) * 100 : 0;
  if (total > 0 && (isTerminal || current > 0 || snapshotProgress >= store.progress)) {
    store.updateProgress(current, total);
  }
};

const applyMaintenanceTaskSnapshot = (task: ScanTaskDto): void => {
  useMaintenanceExecutionStore.getState().setExecutionStatus(taskStatusToMaintenanceStatus(task.status));
};

export const hydrateMaintenancePreview = (response: MaintenancePreviewResponse): MaintenancePreviewItem[] => {
  const items = response.items.map(maintenancePreviewDtoToPreviewItem);
  applyMaintenancePreviewResult({ items });
  return items;
};

const maintenanceApplyLogDtoToItemResult = (item: MaintenanceApplyLogDto) => ({
  fileId: `${item.rootId}:${item.relativePath}`,
  status: item.status === "success" ? ("success" as const) : ("failed" as const),
  ...(item.error || item.status === "skipped" ? { error: item.error ?? "已跳过" } : {}),
});

export const applyWebTaskUpdate = (payload: WebTaskUpdateDto, previous: TaskHydrationState): TaskHydrationState => {
  const next = { ...previous, shouldOpenUncensoredDialog: false };

  if (payload.kind === "snapshot") {
    const previousScrapeTask = payload.tasks.find(
      (task) => task.kind === "scrape" && task.id === previous.activeScrapeTaskId,
    );
    const previousMaintenanceTask = payload.tasks.find(
      (task) => task.kind === "maintenance" && task.id === previous.activeMaintenanceTaskId,
    );
    const activeScrapeTask =
      previousScrapeTask ?? payload.tasks.find((task) => task.kind === "scrape" && isActiveTaskStatus(task.status));
    const activeMaintenanceTask =
      previousMaintenanceTask ??
      payload.tasks.find((task) => task.kind === "maintenance" && isActiveTaskStatus(task.status));

    if (activeScrapeTask) {
      next.activeScrapeTaskId = activeScrapeTask.id;
      applyScrapeTaskSnapshot(activeScrapeTask);
    }

    if (activeMaintenanceTask) {
      next.activeMaintenanceTaskId = activeMaintenanceTask.id;
      applyMaintenanceTaskSnapshot(activeMaintenanceTask);
    }

    return next;
  }

  if (payload.kind === "task") {
    if (payload.task.kind === "scrape") {
      next.activeScrapeTaskId = payload.task.id;
      applyScrapeTaskSnapshot(payload.task);
    }

    if (payload.task.kind === "maintenance") {
      next.activeMaintenanceTaskId = payload.task.id;
      applyMaintenanceTaskSnapshot(payload.task);
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

export const applyTaskRealtimeEvent = (
  payload: TaskRealtimeEventDto,
  previous: TaskHydrationState,
): TaskHydrationState => {
  const next = { ...previous, shouldOpenUncensoredDialog: false };

  switch (payload.kind) {
    case "log":
      return next;
    case "task-progress":
      if (payload.taskKind === "scrape") {
        next.activeScrapeTaskId = payload.taskId;
        useScrapeStore.getState().setScraping(true);
        useScrapeStore.getState().setScrapeStatus("running");
        useScrapeStore
          .getState()
          .updateProgress(payload.value ?? payload.current, payload.value === undefined ? payload.total : 100);
      }
      if (payload.taskKind === "maintenance") {
        next.activeMaintenanceTaskId = payload.taskId;
        useMaintenanceExecutionStore
          .getState()
          .setProgress(
            payload.value ?? (payload.total > 0 ? Math.round((payload.current / payload.total) * 100) : 0),
            payload.current,
            payload.total,
          );
      }
      return next;
    case "scrape-stage":
      next.activeScrapeTaskId = payload.taskId;
      next.latestScrapeStage = {
        taskId: payload.taskId,
        stage: payload.stage,
        message: payload.message,
        ...(payload.relativePath ? { relativePath: payload.relativePath } : {}),
      };
      return next;
    case "scrape-result":
      next.activeScrapeTaskId = payload.taskId;
      useScrapeStore.getState().upsertResult(scrapeResultDtoToScrapeResult(payload.result));
      return next;
    case "task-failed":
      next.latestTaskFailure = {
        taskId: payload.taskId,
        message: payload.message,
        ...(payload.error !== undefined ? { error: payload.error } : {}),
      };
      if (previous.activeScrapeTaskId === payload.taskId) {
        const store = useScrapeStore.getState();
        store.setScrapeStatus("idle");
        store.setScraping(false);
      }
      if (previous.activeMaintenanceTaskId === payload.taskId) {
        useMaintenanceExecutionStore.getState().setExecutionStatus("idle");
      }
      return next;
    case "maintenance-preview-item":
      next.activeMaintenanceTaskId = payload.taskId;
      useMaintenancePreviewStore.getState().upsertPreviewItem(maintenancePreviewDtoToPreviewItem(payload.item));
      return next;
    case "maintenance-apply-item":
      next.activeMaintenanceTaskId = payload.taskId;
      applyMaintenanceExecutionItemResult(maintenanceApplyLogDtoToItemResult(payload.item));
      return next;
  }
};
