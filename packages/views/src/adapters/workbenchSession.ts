import type { AmbiguousUncensoredItemDto, ScrapeFileRefDto } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId, MediaCandidate, UncensoredChoice } from "@mdcz/shared/types";
import {
  changeMaintenancePreset,
  selectMaintenanceHasWork,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { selectIsScraping, selectScrapeHasWork, useScrapeStore } from "@mdcz/views/state/scrapeStore";
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
  const maintenanceStore = useMaintenanceStore.getState();
  const isScraping = selectIsScraping(scrapeStore);
  const scrapeHasWork = selectScrapeHasWork(scrapeStore);
  const maintenanceHasWork = selectMaintenanceHasWork(maintenanceStore);
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

export const useWorkbenchSessionSnapshot = (
  currentMode: WorkbenchMode,
  routeIntent?: WorkbenchRouteIntent,
): WorkbenchSessionSnapshot => {
  const scrapeHasWork = useScrapeStore(selectScrapeHasWork);
  const isScraping = useScrapeStore(selectIsScraping);
  const maintenanceHasWork = useMaintenanceStore(selectMaintenanceHasWork);
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
  useScrapeStore.getState().reset();
  useScrapeStore.getState().setPending(true);
  useUIStore.getState().setSelectedResultId(null);
};

/**
 * Activates a retry that the backend runs as its own task, without discarding the results
 * already in the queue. Only the retried entries are reset to `processing`.
 */
export const activateRetryScrapeTask = (): void => {
  useScrapeStore.getState().setPending(true);
};

export const applyScrapeTaskStatus = (): void => {
  useScrapeStore.getState().setPending(true);
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

export interface StartMaintenanceFlowOptions {
  candidates: MediaCandidate[];
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
    executionStore.setPending(true);

    const refs = options.candidates.map((candidate) => candidate.ref);
    if (refs.length === 0) {
      executionStore.setPending(false);
      options.toast.info("未发现可维护项目");
      await options.onRefreshConfig?.();
      return;
    }

    if (options.presetId === "read_local") {
      await options.port.preview(refs, options.presetId);
      options.toast.success(`本地读取已启动，共 ${options.candidates.length} 项`);
      await options.onRefreshConfig?.();
      return;
    }

    await options.port.preview(refs, options.presetId);
    await options.onRefreshConfig?.();
    options.toast.success("维护预览已启动");
  } catch (error) {
    if (options.toErrorMessage(error) === "Operation aborted") {
      executionStore.setPending(false);
      return;
    }

    executionStore.setError(options.toErrorMessage(error));
    options.toast.error(`启动失败: ${options.toErrorMessage(error)}`);
  }
};
