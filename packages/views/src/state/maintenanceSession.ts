import type {
  LocalScanEntry,
  MaintenanceClientSession,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewItem,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "@mdcz/shared/types";
import { useMaintenanceEntryStore } from "./maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "./maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "./maintenancePreviewStore";

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
  const executionStore = useMaintenanceExecutionStore.getState();
  if (payload.batchId && executionStore.activeBatchId && payload.batchId !== executionStore.activeBatchId) return;
  useMaintenanceEntryStore.getState().applyExecutionResult(payload);
  if (payload.status === "success" || payload.status === "failed" || payload.status === "skipped") {
    useMaintenancePreviewStore.getState().removePreviewItem(payload.fileId);
  }
  executionStore.applyItemResult(payload);
};

export const applyMaintenanceStatusSnapshot = (status: MaintenanceStatus): void => {
  useMaintenanceExecutionStore.getState().applyStatusSnapshot(status);
};

export const applyMaintenanceClientSession = (session: MaintenanceClientSession | null): void => {
  if (!session) {
    resetMaintenanceSession();
    return;
  }
  const entries = session.entries;
  const activeFileIds = new Set(session.currentResults.map((result) => result.fileId));
  const hasActiveBatch =
    session.status.state === "executing" || session.status.state === "paused" || session.status.state === "stopping";
  useMaintenanceEntryStore.setState((state) => ({
    entries,
    selectedIds: hasActiveBatch
      ? entries.filter((entry) => activeFileIds.has(entry.fileId)).map((entry) => entry.fileId)
      : entries.map((entry) => entry.fileId),
    activeId:
      state.activeId && entries.some((entry) => entry.fileId === state.activeId)
        ? state.activeId
        : (entries[0]?.fileId ?? null),
    presetId: session.presetId,
    currentPath: entries[0]?.fileInfo.filePath ?? state.currentPath,
  }));
  useMaintenancePreviewStore.setState({
    previewPending: session.status.state === "previewing",
    previewResults: Object.fromEntries(session.preview.items.map((item) => [item.fileId, item])),
    fieldSelections: session.fieldSelections,
    imageSelections: session.imageSelections,
    executeDialogOpen: false,
  });
  useMaintenanceExecutionStore.setState({
    executionStatus: session.status.state,
    progressValue:
      session.status.totalEntries > 0
        ? Math.round((session.status.completedEntries / session.status.totalEntries) * 100)
        : 0,
    progressCurrent: session.status.completedEntries,
    progressTotal: session.status.totalEntries,
    itemResults: Object.fromEntries(
      [...session.recentResults, ...session.currentResults].map((result) => [result.fileId, result]),
    ),
    activeBatchId: session.batchId,
  });
};
