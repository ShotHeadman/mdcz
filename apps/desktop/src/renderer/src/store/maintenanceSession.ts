import type {
  LocalScanEntry,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewItem,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "@mdcz/shared/types";
import { useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@/store/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@/store/maintenancePreviewStore";

const isExecutionIdle = (): boolean => useMaintenanceExecutionStore.getState().executionStatus === "idle";

const preservesPreviewAcrossSelectionChanges = (presetId: MaintenancePresetId): boolean =>
  presetId === "refresh_data" || presetId === "rebuild_all";

const resolveNextActiveId = (
  currentActiveId: string | null,
  previewResults: Record<string, MaintenancePreviewItem>,
): string | null => {
  if (currentActiveId && previewResults[currentActiveId]) {
    return currentActiveId;
  }

  return Object.values(previewResults)[0]?.fileId ?? currentActiveId;
};

export const beginMaintenancePreviewRequest = (): void => {
  useMaintenancePreviewStore.getState().beginPreviewRequest();
};

export const setMaintenancePreviewPending = (pending: boolean): void => {
  useMaintenancePreviewStore.getState().setPreviewPending(pending);
};

export const clearMaintenancePreviewResults = (): void => {
  useMaintenancePreviewStore.getState().clearPreviewResults();
};

export const invalidateMaintenancePreview = (): void => {
  if (isExecutionIdle()) {
    useMaintenanceExecutionStore.getState().resetDerivedData();
  }

  useMaintenancePreviewStore.getState().reset();
};

export const cancelMaintenancePreviewFlow = (): void => {
  useMaintenancePreviewStore.getState().reset();
  useMaintenanceExecutionStore.getState().resetDerivedData();
};

export const applyMaintenancePreviewResult = (result: MaintenancePreviewResult): void => {
  if (isExecutionIdle()) {
    useMaintenanceExecutionStore.getState().resetDerivedData();
  }

  const entryStore = useMaintenanceEntryStore.getState();
  const previewResults = Object.fromEntries(result.items.map((item) => [item.fileId, item]));
  const nextActiveId = resolveNextActiveId(entryStore.activeId, previewResults);

  useMaintenancePreviewStore.getState().applyPreviewResult(result);

  if (nextActiveId !== entryStore.activeId) {
    entryStore.setActiveId(nextActiveId);
  }
};

export const applyMaintenanceScanResult = (entries: LocalScanEntry[], dirPath: string): void => {
  useMaintenanceEntryStore.getState().setEntries(entries, dirPath);
  useMaintenancePreviewStore.getState().clearPreviewResults();
  useMaintenanceExecutionStore.getState().resetDerivedData();
};

export const changeMaintenancePreset = (presetId: MaintenancePresetId): void => {
  invalidateMaintenancePreview();
  useMaintenanceEntryStore.getState().setPresetId(presetId);
};

export const toggleMaintenanceSelectedIds = (ids: string[]): void => {
  const entryStore = useMaintenanceEntryStore.getState();

  if (!preservesPreviewAcrossSelectionChanges(entryStore.presetId)) {
    invalidateMaintenancePreview();
  }

  entryStore.toggleSelectedIds(ids);
};

export const beginMaintenanceExecution = (fileIds: string[]): void => {
  useMaintenanceExecutionStore.getState().beginExecution({
    fileIds,
  });
};

export const resetMaintenanceSession = (): void => {
  useMaintenancePreviewStore.getState().reset();
  useMaintenanceExecutionStore.getState().reset();
  useMaintenanceEntryStore.getState().reset();
};

export const applyMaintenanceExecutionItemResult = (payload: MaintenanceItemResult): void => {
  useMaintenanceEntryStore.getState().applyExecutionResult(payload);
  useMaintenanceExecutionStore.getState().applyItemResult(payload);
};

export const applyMaintenanceStatusSnapshot = (status: MaintenanceStatus): void => {
  useMaintenanceExecutionStore.getState().applyStatusSnapshot(status);
};
