import type {
  LocalScanEntry,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewItem,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "@shared/types";
import { formatMaintenanceIdleStatusText } from "@/lib/maintenanceGrouping";
import { useMaintenanceEntryStore } from "@/store/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@/store/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@/store/maintenancePreviewStore";

const isExecutionIdle = (): boolean => useMaintenanceExecutionStore.getState().executionStatus === "idle";

const getIdleStatusText = (entries = useMaintenanceEntryStore.getState().entries): string =>
  formatMaintenanceIdleStatusText(entries);

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
    useMaintenanceExecutionStore.getState().resetDerivedData(getIdleStatusText());
  }

  useMaintenancePreviewStore.getState().reset();
};

export const applyMaintenancePreviewResult = (result: MaintenancePreviewResult): void => {
  if (isExecutionIdle()) {
    useMaintenanceExecutionStore.getState().resetDerivedData(getIdleStatusText());
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
  useMaintenanceExecutionStore.getState().resetDerivedData(getIdleStatusText(entries));
};

export const changeMaintenancePreset = (presetId: MaintenancePresetId): void => {
  invalidateMaintenancePreview();
  useMaintenanceEntryStore.getState().setPresetId(presetId);
};

export const toggleMaintenanceSelectedIds = (ids: string[]): void => {
  invalidateMaintenancePreview();
  useMaintenanceEntryStore.getState().toggleSelectedIds(ids);
};

export const beginMaintenanceExecution = (fileIds: string[], displayCount: number): void => {
  useMaintenanceExecutionStore.getState().beginExecution({
    fileIds,
    displayCount,
  });
};

export const applyMaintenanceExecutionItemResult = (payload: MaintenanceItemResult): void => {
  useMaintenanceEntryStore.getState().applyExecutionResult(payload);
  useMaintenanceExecutionStore.getState().applyItemResult(payload);
};

export const applyMaintenanceStatusSnapshot = (status: MaintenanceStatus): void => {
  useMaintenanceExecutionStore.getState().applyStatusSnapshot(status, useMaintenanceEntryStore.getState().entries);
};
