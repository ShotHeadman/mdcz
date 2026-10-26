import { toErrorMessage } from "@mdcz/shared/error";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { LibraryEntryDto, LibraryHealthIssue } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import {
  changeMaintenancePreset,
  resetMaintenanceSession,
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
import { toast } from "sonner";
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

/**
 * Starting a task from Overview is a deliberate new start: a finished or stopped result makes way for the setup,
 * while running work and a preview still waiting for review stay open.
 */
export const openNewWorkbenchTask = async (
  mode: WorkbenchMode,
  discardMaintenanceSession: () => Promise<void>,
): Promise<void> => {
  if (selectIsScraping(useScrapeStore.getState())) return;
  const { snapshot, pending } = useMaintenanceStore.getState();
  const finished =
    snapshot !== null &&
    (["failed", "stopped", "interrupted"].includes(snapshot.status) ||
      (snapshot.status === "completed" && snapshot.phase === "apply"));
  if (pending || (snapshot && !finished)) return;
  if (snapshot) {
    await discardMaintenanceSession();
    resetMaintenanceSession();
  }
  if (useScrapeStore.getState().snapshot) resetScrapeWorkbenchToSetup();
  useUIStore.getState().setWorkbenchMode(mode);
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
  setWorkbenchMode?: (mode: WorkbenchMode) => void;
  onRefreshConfig?: () => Promise<void> | void;
}

export const startMaintenanceFlow = async (options: StartMaintenanceFlowOptions): Promise<void> => {
  const executionStore = useMaintenanceStore.getState();
  try {
    options.setWorkbenchMode?.("maintenance");
    changeMaintenancePreset(options.presetId);
    executionStore.setPending(true);
    await options.port.preview(options.refs, options.presetId, options.libraryId);
    await options.onRefreshConfig?.();
  } catch (error) {
    const message = toErrorMessage(error);
    if (message === "Operation aborted") {
      executionStore.setPending(false);
      return;
    }
    executionStore.setError(message);
    toast.error(getT().maintenance.startFailed(message), { id: "maintenance" });
  }
};

/** Previews a site refresh of the movies that have `issue`; the user reviews and applies it in the workbench. */
export const startHealthFix = async (options: {
  issue: LibraryHealthIssue;
  libraryId?: string;
  entries: LibraryEntryDto[];
  port: MaintenanceActionPort;
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
    setWorkbenchMode: useUIStore.getState().setWorkbenchMode,
  });
};
