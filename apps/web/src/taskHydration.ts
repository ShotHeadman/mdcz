import { maintenancePreviewDtoToPreviewItem } from "@mdcz/shared/dtoAdapters";
import type {
  MaintenanceApplyLogDto,
  MaintenancePreviewResponse,
  ScanTaskDto,
  ScrapeLiveItemDto,
  ScrapeLiveRunSnapshotDto,
  ScrapePendingUncensoredConfirmationResponse,
  TaskRealtimeEventDto,
  WebTaskUpdateDto,
} from "@mdcz/shared/serverDtos";
import type { MaintenancePreviewItem, ScrapeResult } from "@mdcz/shared/types";
import { useMaintenanceExecutionStore } from "@mdcz/views/state/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@mdcz/views/state/maintenancePreviewStore";
import {
  applyMaintenanceExecutionItemResult,
  applyMaintenancePreviewResult,
} from "@mdcz/views/state/maintenanceSession";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import type { TaskHydrationState } from "@mdcz/views/state/workbenchTaskStore";

export type { TaskHydrationState } from "@mdcz/views/state/workbenchTaskStore";

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
  scrapeStore.updateProgress(selected.progress.completedItems, selected.progress.totalItems);
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
  batchId: item.batchId,
  status: item.status,
  ...(item.error || item.status === "skipped" ? { error: item.error ?? "已跳过" } : {}),
});

/** Applies only generic task and Maintenance state.  Scrape state comes from liveRuns(). */
export const applyWebTaskUpdate = (payload: WebTaskUpdateDto, previous: TaskHydrationState): TaskHydrationState => {
  const next = { ...previous, shouldOpenUncensoredDialog: false };

  if (payload.kind === "scrape-invalidated") return next;

  if (payload.kind === "snapshot") {
    const previousMaintenanceTask = payload.tasks.find(
      (task) => task.kind === "maintenance" && task.id === previous.activeMaintenanceTaskId,
    );
    const activeMaintenanceTask =
      previousMaintenanceTask ??
      payload.tasks.find((task) => task.kind === "maintenance" && isActiveTaskStatus(task.status));

    if (activeMaintenanceTask) {
      next.activeMaintenanceTaskId = activeMaintenanceTask.id;
      applyMaintenanceTaskSnapshot(activeMaintenanceTask);
    }

    return next;
  }

  if (payload.kind === "task") {
    if (payload.task.kind === "maintenance") {
      next.activeMaintenanceTaskId = payload.task.id;
      applyMaintenanceTaskSnapshot(payload.task);
    }
    return next;
  }

  return next;
};

/**
 * Realtime task events continue to feed generic logs and Maintenance UI.  A
 * scrape event never mutates the workbench's live snapshot; invalidation plus
 * the serialized liveRuns read does that instead.
 */
export const applyTaskRealtimeEvent = (
  payload: TaskRealtimeEventDto,
  previous: TaskHydrationState,
): TaskHydrationState => {
  const next = { ...previous, shouldOpenUncensoredDialog: false };

  switch (payload.kind) {
    case "log":
    case "scrape-stage":
    case "scrape-result":
      return next;
    case "task-progress":
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
    case "task-failed":
      next.latestTaskFailure = {
        taskId: payload.taskId,
        message: payload.message,
        ...(payload.error !== undefined ? { error: payload.error } : {}),
      };
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
