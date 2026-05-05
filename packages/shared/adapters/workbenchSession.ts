import type { AmbiguousUncensoredItemDto, ScanTaskDto, ScrapeFileRefDto } from "../serverDtos";
import { useMaintenanceEntryStore } from "../stores/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "../stores/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "../stores/maintenancePreviewStore";
import {
  applyMaintenancePreviewResult,
  applyMaintenanceScanResult,
  beginMaintenancePreviewRequest,
  cancelMaintenancePreviewFlow,
  changeMaintenancePreset,
  setMaintenancePreviewPending,
} from "../stores/maintenanceSession";
import { useScrapeStore } from "../stores/scrapeStore";
import { useUIStore } from "../stores/uiStore";
import type { MaintenancePresetId, UncensoredChoice } from "../types";
import { countMaintenanceDisplayItems } from "../viewModels/maintenanceGrouping";
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
  const maintenanceStatus = useMaintenanceExecutionStore.getState().executionStatus;
  const maintenanceEntries = useMaintenanceEntryStore.getState().entries;
  const maintenancePreviewResults = useMaintenancePreviewStore.getState().previewResults;
  const maintenanceItemResults = useMaintenanceExecutionStore.getState().itemResults;
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
  const maintenanceStatus = useMaintenanceExecutionStore((state) => state.executionStatus);
  const maintenanceEntryCount = useMaintenanceEntryStore((state) => state.entries.length);
  const maintenancePreviewCount = useMaintenancePreviewStore((state) => Object.keys(state.previewResults).length);
  const maintenanceItemResultCount = useMaintenanceExecutionStore((state) => Object.keys(state.itemResults).length);
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

export const activateNewScrapeTask = (): void => {
  const scrapeStore = useScrapeStore.getState();
  scrapeStore.clearResults();
  scrapeStore.updateProgress(0, 0);
  scrapeStore.setScraping(true);
  scrapeStore.setScrapeStatus("running");
  useUIStore.getState().setSelectedResultId(null);
};

export const applyScrapeTaskStatus = (status: ScanTaskDto["status"]): void => {
  const scrapeStore = useScrapeStore.getState();
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
  useScrapeStore.getState().reset();
};

export const getFailedScrapeTargets = () =>
  useScrapeStore
    .getState()
    .results.filter((result) => result.status === "failed")
    .map((result) => {
      const [rootId, ...relativeParts] = result.fileId.split(":");
      const relativePath = relativeParts.join(":");
      return {
        filePath: result.fileInfo.filePath,
        ref: rootId && relativePath ? { rootId, relativePath } : undefined,
      };
    });

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

  const executionStore = useMaintenanceExecutionStore.getState();

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
