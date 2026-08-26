import { buildFileId, normalizePathForIdentity } from "@mdcz/shared/mediaIdentity";
import type { AmbiguousUncensoredItemDto, ScanTaskDto, ScrapeFileRefDto } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId, UncensoredChoice } from "@mdcz/shared/types";
import { countMaintenanceDisplayItems } from "@mdcz/shared/viewModels/maintenanceGrouping";
import {
  applyMaintenancePreviewResult,
  applyMaintenanceScanResult,
  beginMaintenancePreviewRequest,
  cancelMaintenancePreviewFlow,
  changeMaintenancePreset,
  setMaintenancePreviewPending,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import type { MaintenanceActionPort } from "./ports";

export type WorkbenchMode = "scrape" | "maintenance";
export type WorkbenchRouteIntent = "maintenance" | undefined;

export interface WorkbenchSessionSnapshot {
  workbenchMode: WorkbenchMode;
  scrapeHasWork: boolean;
  maintenanceHasWork: boolean;
  showSetup: boolean;
}

export const resolveWorkbenchMode = (input: {
  currentMode: WorkbenchMode;
  routeIntent?: WorkbenchRouteIntent;
  isScraping: boolean;
  scrapeHasWork: boolean;
  maintenanceHasWork: boolean;
}): WorkbenchMode => {
  if (input.routeIntent === "maintenance" && !input.isScraping) {
    return "maintenance";
  }

  if (input.maintenanceHasWork && !input.scrapeHasWork) {
    return "maintenance";
  }

  if (!input.maintenanceHasWork && (!input.scrapeHasWork || input.currentMode === "maintenance")) {
    return "scrape";
  }

  return input.currentMode;
};

export const getWorkbenchSessionSnapshot = (
  currentMode: WorkbenchMode,
  routeIntent?: WorkbenchRouteIntent,
): WorkbenchSessionSnapshot => {
  const scrapeStore = useScrapeStore.getState();
  const maintenanceStatus = useMaintenanceStore.getState().executionStatus;
  const maintenanceEntries = useMaintenanceStore.getState().entries;
  const maintenancePreviewResults = useMaintenanceStore.getState().previewResults;
  const maintenanceItemResults = useMaintenanceStore.getState().itemResults;
  const scrapeHasWork = scrapeStore.isScraping || scrapeStore.scrapeStatus !== "idle" || scrapeStore.results.length > 0;
  const maintenanceHasWork =
    maintenanceStatus !== "idle" ||
    maintenanceEntries.length > 0 ||
    Object.keys(maintenancePreviewResults).length > 0 ||
    Object.keys(maintenanceItemResults).length > 0;
  const workbenchMode = resolveWorkbenchMode({
    currentMode,
    routeIntent,
    isScraping: scrapeStore.isScraping,
    scrapeHasWork,
    maintenanceHasWork,
  });

  return {
    workbenchMode,
    scrapeHasWork,
    maintenanceHasWork,
    showSetup: workbenchMode === "maintenance" ? !maintenanceHasWork : !scrapeHasWork,
  };
};

export const useWorkbenchSessionSnapshot = (
  currentMode: WorkbenchMode,
  routeIntent?: WorkbenchRouteIntent,
): WorkbenchSessionSnapshot => {
  const scrapeHasWork = useScrapeStore(
    (state) => state.isScraping || state.scrapeStatus !== "idle" || state.results.length > 0,
  );
  const isScraping = useScrapeStore((state) => state.isScraping);
  const maintenanceStatus = useMaintenanceStore((state) => state.executionStatus);
  const maintenanceEntryCount = useMaintenanceStore((state) => state.entries.length);
  const maintenancePreviewCount = useMaintenanceStore((state) => Object.keys(state.previewResults).length);
  const maintenanceItemResultCount = useMaintenanceStore((state) => Object.keys(state.itemResults).length);
  const maintenanceHasWork =
    maintenanceStatus !== "idle" ||
    maintenanceEntryCount > 0 ||
    maintenancePreviewCount > 0 ||
    maintenanceItemResultCount > 0;
  const workbenchMode = resolveWorkbenchMode({
    currentMode,
    routeIntent,
    isScraping,
    scrapeHasWork,
    maintenanceHasWork,
  });

  return {
    workbenchMode,
    scrapeHasWork,
    maintenanceHasWork,
    showSetup: workbenchMode === "maintenance" ? !maintenanceHasWork : !scrapeHasWork,
  };
};

export const activateNewScrapeTask = (filePaths?: string[]): void => {
  const scrapeStore = useScrapeStore.getState();
  scrapeStore.clearResults();
  if (filePaths) {
    scrapeStore.seedProcessingResults(filePaths);
  }
  scrapeStore.updateProgress(0, 0);
  scrapeStore.setScraping(true);
  scrapeStore.setScrapeStatus("running");
  useUIStore.getState().setSelectedResultId(null);
};

/**
 * Activates a retry that the backend runs as its own task, without discarding the results
 * already in the queue. Only the retried entries are reset to `processing`.
 */
export const activateRetryScrapeTask = (filePaths: string[]): void => {
  const scrapeStore = useScrapeStore.getState();
  const uiStore = useUIStore.getState();
  const selectedResult = scrapeStore.results.find((result) => result.fileId === uiStore.selectedResultId);
  const retryPaths = new Set(filePaths.map(normalizePathForIdentity));

  scrapeStore.markResultsRetrying(filePaths);

  if (selectedResult && retryPaths.has(normalizePathForIdentity(selectedResult.fileInfo.filePath))) {
    uiStore.setSelectedResultId(buildFileId(selectedResult.fileInfo.filePath));
  }

  scrapeStore.updateProgress(0, 0);
  scrapeStore.setScraping(true);
  scrapeStore.setScrapeStatus("running");
};

export const applyScrapeTaskStatus = (status: ScanTaskDto["status"]): void => {
  const scrapeStore = useScrapeStore.getState();
  const previousStatus = scrapeStore.scrapeStatus;
  if (status === "running" || status === "queued") {
    scrapeStore.setScrapeStatus("running");
    scrapeStore.setScraping(true);
    return;
  }
  if (status === "paused") {
    scrapeStore.setScrapeStatus("paused");
    scrapeStore.setScraping(true);
    return;
  }
  if (status === "stopping") {
    scrapeStore.setScrapeStatus("stopping");
    scrapeStore.setScraping(true);
    return;
  }
  if (previousStatus !== "idle") {
    scrapeStore.failUnfinishedResults("已停止或未完成");
  }
  scrapeStore.setScrapeStatus("idle");
  scrapeStore.setScraping(false);
};

export interface UncensoredConfirmationSelection {
  id: string;
  choice: UncensoredChoice;
}

export const buildUncensoredConfirmationItems = (
  ambiguousItems: AmbiguousUncensoredItemDto[],
  selections: UncensoredConfirmationSelection[],
): Array<{ ref: ScrapeFileRefDto; choice: UncensoredChoice }> => {
  const choicesById = new Map(selections.map((selection) => [selection.id, selection.choice]));
  return ambiguousItems.map((item) => ({
    ref: item.ref,
    choice: choicesById.get(item.id) ?? "uncensored",
  }));
};

export const resetScrapeWorkbenchToSetup = (): void => {
  useUIStore.getState().setSelectedResultId(null);
  useWorkbenchTaskStore.getState().reset();
  useScrapeStore.getState().reset();
};

export const getFailedScrapeTargets = () =>
  useScrapeStore
    .getState()
    .results.filter((result) => result.status === "failed")
    .map((result) => ({ filePath: result.fileInfo.filePath }));

export interface StartMaintenanceFlowOptions {
  filePaths: string[];
  scanDir: string;
  presetId: MaintenancePresetId;
  port: MaintenanceActionPort;
  isScraping: boolean;
  setWorkbenchMode?: (mode: WorkbenchMode) => void;
  onRefreshConfig?: () => Promise<void> | void;
  toast: {
    info(message: string): void;
    success(message: string): void;
    warning(message: string): void;
    error(message: string): void;
  };
  toErrorMessage(error: unknown): string;
}

export const startMaintenanceFlow = async (options: StartMaintenanceFlowOptions): Promise<void> => {
  if (options.isScraping) {
    options.toast.warning("正常刮削正在运行中，无法启动维护模式。请先停止当前刮削任务。");
    return;
  }

  const executionStore = useMaintenanceStore.getState();

  try {
    options.setWorkbenchMode?.("maintenance");
    changeMaintenancePreset(options.presetId);
    executionStore.setExecutionStatus("scanning");

    const scan = await options.port.scanFiles(options.filePaths, {
      scanDir: options.scanDir,
    });
    applyMaintenanceScanResult(scan.entries, options.scanDir);

    if (scan.entries.length === 0) {
      options.toast.info("未发现可维护项目");
      await options.onRefreshConfig?.();
      return;
    }

    if (options.presetId === "read_local") {
      executionStore.setExecutionStatus("previewing");
      beginMaintenancePreviewRequest();
      executionStore.setProgress(0, 0, scan.entries.length);
      const preview = await options.port.preview(scan.entries, options.presetId);
      applyMaintenancePreviewResult(preview);
      executionStore.setExecutionStatus("idle");
      options.toast.success(`本地读取完成，共 ${countMaintenanceDisplayItems(scan.entries)} 项`);
      await options.onRefreshConfig?.();
      return;
    }

    executionStore.setExecutionStatus("previewing");
    beginMaintenancePreviewRequest();
    executionStore.setProgress(0, 0, scan.entries.length);
    const preview = await options.port.preview(scan.entries, options.presetId);
    applyMaintenancePreviewResult(preview);
    executionStore.setExecutionStatus("idle");
    await options.onRefreshConfig?.();
    options.toast.success("维护预览已生成");
  } catch (error) {
    if (options.toErrorMessage(error) === "Operation aborted") {
      cancelMaintenancePreviewFlow();
      return;
    }

    setMaintenancePreviewPending(false);
    executionStore.setExecutionStatus("idle");
    options.toast.error(`启动失败: ${options.toErrorMessage(error)}`);
  }
};
