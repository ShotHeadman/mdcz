import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { LibraryEntryDto, LibraryHealthIssue } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import {
  changeMaintenancePreset,
  selectMaintenanceHasWork,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import {
  selectIsScraping,
  selectScrapeHasWork,
  selectScrapeSnapshot,
  useScrapeStore,
} from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useWorkbenchSetupStore } from "@mdcz/views/state/workbenchSetupStore";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { useEffect, useRef } from "react";
import { getT } from "../i18n";
import { HEALTH_FIX_PRESETS } from "../library/healthIssues";
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

export const useScrapeTerminalError = (showError: (error: string) => void): void => {
  const scrapeSnapshot = useScrapeStore(selectScrapeSnapshot);
  const shownErrors = useRef(new Set<string>());

  useEffect(() => {
    const task = scrapeSnapshot?.task;
    if (task?.status !== "failed" || !task.error) return;
    const key = `${task.id}:${task.updatedAt}`;
    if (shownErrors.current.has(key)) return;
    shownErrors.current.add(key);
    showError(task.error);
  }, [scrapeSnapshot, showError]);
};

export const activateNewScrapeTask = (): void => {
  useUIStore.getState().setSelectedResultId(null);
};

export const resetScrapeWorkbenchToSetup = (): void => {
  useUIStore.getState().setSelectedResultId(null);
  useWorkbenchTaskStore.getState().reset();
  useScrapeStore.getState().reset();
};

/** Points the workbench setup at a directory and preset; the setup then scans the directory by itself. */
export const prepareMaintenanceSetup = (input: {
  scanDir: string;
  libraryId: string;
  presetId: MaintenancePresetId;
}): void => {
  useWorkbenchSetupStore.getState().setScanDir(input.scanDir);
  useWorkbenchSetupStore.getState().setLibraryId(input.libraryId);
  changeMaintenancePreset(input.presetId);
  useUIStore.getState().setWorkbenchMode("maintenance");
};

export interface StartMaintenanceFlowOptions {
  refs: RootFileRef[];
  presetId: MaintenancePresetId;
  libraryId?: string;
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
  const t = getT();
  if (options.isScraping) {
    options.toast.warning(t.maintenance.scrapeRunningCannotMaintain);
    return;
  }

  const executionStore = useMaintenanceStore.getState();

  try {
    options.setWorkbenchMode?.("maintenance");
    changeMaintenancePreset(options.presetId);
    executionStore.setPending(true);

    const { refs } = options;
    if (refs.length === 0) {
      executionStore.setPending(false);
      options.toast.info(t.maintenance.noMaintainableItems);
      await options.onRefreshConfig?.();
      return;
    }

    await options.port.preview(refs, options.presetId, options.libraryId);
    await options.onRefreshConfig?.();
    options.toast.success(
      options.presetId === "import_local"
        ? t.maintenance.localImportStarted(refs.length)
        : t.maintenance.previewStarted,
    );
  } catch (error) {
    if (options.toErrorMessage(error) === "Operation aborted") {
      executionStore.setPending(false);
      return;
    }

    executionStore.setError(options.toErrorMessage(error));
    options.toast.error(t.maintenance.startFailed(options.toErrorMessage(error)));
  }
};

/** Previews a site refresh of the movies that have `issue`; the user reviews and applies it in the workbench. */
export const startHealthFix = async (options: {
  issue: LibraryHealthIssue;
  libraryId?: string;
  entries: LibraryEntryDto[];
  port: MaintenanceActionPort;
  isScraping: boolean;
  toast: StartMaintenanceFlowOptions["toast"];
  toErrorMessage(error: unknown): string;
}): Promise<void> => {
  const t = getT();
  const presetId = HEALTH_FIX_PRESETS[options.issue];
  if (!presetId) throw new Error(`No repair for ${options.issue}`);
  const refs = options.entries.flatMap((entry) =>
    entry.fileRefs.map((file) => ({ rootId: file.rootId, relativePath: file.relativePath })),
  );
  // A maintenance session works inside one media root.
  if (new Set(refs.map((ref) => ref.rootId)).size > 1) throw new Error(t.library.health.mixedRoots);
  await startMaintenanceFlow({
    refs,
    presetId,
    libraryId: options.libraryId,
    port: options.port,
    isScraping: options.isScraping,
    setWorkbenchMode: useUIStore.getState().setWorkbenchMode,
    toast: options.toast,
    toErrorMessage: options.toErrorMessage,
  });
};
