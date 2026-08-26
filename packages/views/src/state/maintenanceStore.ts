import type { MaintenanceFieldSelectionSide } from "@mdcz/shared/maintenanceCommit";
import type { MaintenanceActiveSessionSnapshot } from "@mdcz/shared/maintenanceTasks";
import type {
  LocalScanEntry,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewItem,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "@mdcz/shared/types";
import { create } from "zustand";

export type MaintenanceFilter = "all" | "success" | "failed";
type ExecutionStatus = MaintenanceStatus["state"];

const initialState = () => ({
  snapshot: null as MaintenanceActiveSessionSnapshot | null,
  entries: [] as LocalScanEntry[],
  selectedIds: [] as string[],
  activeId: null as string | null,
  presetId: "read_local" as MaintenancePresetId,
  filter: "all" as MaintenanceFilter,
  currentPath: "",
  lastScannedDir: "",
  executionStatus: "idle" as ExecutionStatus,
  progressValue: 0,
  progressCurrent: 0,
  progressTotal: 0,
  itemResults: {} as Record<string, MaintenanceItemResult>,
  activeBatchId: null as string | null,
  previewPending: false,
  previewResults: {} as Record<string, MaintenancePreviewItem>,
  fieldSelections: {} as Record<string, Record<string, MaintenanceFieldSelectionSide>>,
  imageSelections: {} as Record<string, Record<string, string>>,
  executeDialogOpen: false,
});

export interface MaintenanceState extends ReturnType<typeof initialState> {
  setPresetId(presetId: MaintenancePresetId): void;
  setEntries(entries: LocalScanEntry[], dirPath: string): void;
  setActiveId(id: string | null): void;
  toggleSelectedIds(ids: string[]): void;
  setFilter(filter: MaintenanceFilter): void;
  setCurrentPath(path: string): void;
  setExecutionStatus(status: ExecutionStatus): void;
  setProgress(value: number, current: number, total: number): void;
  beginExecution(input: { fileIds: string[] }): void;
  rollbackExecutionStart(): void;
  setPreviewPending(pending: boolean): void;
  setExecuteDialogOpen(open: boolean): void;
  reset(): void;
}

export const useMaintenanceStore = create<MaintenanceState>()((set) => ({
  ...initialState(),
  setPresetId: (presetId) => set({ presetId }),
  setEntries: (entries, dirPath) =>
    set((state) => ({
      snapshot: null,
      entries,
      selectedIds: entries.map((entry) => entry.fileId),
      activeId:
        state.activeId && entries.some((entry) => entry.fileId === state.activeId)
          ? state.activeId
          : (entries[0]?.fileId ?? null),
      currentPath: dirPath,
      lastScannedDir: dirPath,
      filter: "all",
    })),
  setActiveId: (activeId) => set({ activeId }),
  toggleSelectedIds: (ids) =>
    set((state) => ({
      selectedIds: ids.every((id) => state.selectedIds.includes(id))
        ? state.selectedIds.filter((id) => !ids.includes(id))
        : [...new Set([...state.selectedIds, ...ids])],
    })),
  setFilter: (filter) => set({ filter }),
  setCurrentPath: (currentPath) => set({ currentPath }),
  setExecutionStatus: (executionStatus) => set({ executionStatus }),
  setProgress: (value, progressCurrent, progressTotal) =>
    set({ progressValue: Math.max(0, Math.min(100, value)), progressCurrent, progressTotal }),
  beginExecution: ({ fileIds }) =>
    set({
      executionStatus: "executing",
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: fileIds.length,
      itemResults: Object.fromEntries(fileIds.map((fileId) => [fileId, { fileId, status: "pending" }])),
      activeBatchId: null,
    }),
  rollbackExecutionStart: () => set((state) => ({ ...state, ...executionState() })),
  setPreviewPending: (previewPending) => set({ previewPending }),
  setExecuteDialogOpen: (executeDialogOpen) => set({ executeDialogOpen }),
  reset: () => set(initialState()),
}));

const executionState = () => ({
  executionStatus: "idle" as ExecutionStatus,
  progressValue: 0,
  progressCurrent: 0,
  progressTotal: 0,
  itemResults: {} as Record<string, MaintenanceItemResult>,
  activeBatchId: null as string | null,
});

const previewState = () => ({
  previewPending: false,
  previewResults: {} as Record<string, MaintenancePreviewItem>,
  fieldSelections: {} as Record<string, Record<string, MaintenanceFieldSelectionSide>>,
  imageSelections: {} as Record<string, Record<string, string>>,
  executeDialogOpen: false,
});

const previewFileId = (preview: MaintenanceActiveSessionSnapshot["previews"][number]): string =>
  preview.entry?.rootRef
    ? `${preview.rootId}:${preview.relativePath}`
    : (preview.entry?.fileId ?? preview.relativePath);

export const maintenanceSnapshotPreviewItems = (session: MaintenanceActiveSessionSnapshot): MaintenancePreviewItem[] =>
  session.previews.map((preview) => ({
    fileId: previewFileId(preview),
    previewId: preview.id,
    taskId: preview.taskId,
    status: preview.status === "ready" ? "ready" : "blocked",
    ...(preview.error ? { error: preview.error } : {}),
    ...(preview.fieldDiffs.length ? { fieldDiffs: preview.fieldDiffs } : {}),
    ...(preview.unchangedFieldDiffs.length ? { unchangedFieldDiffs: preview.unchangedFieldDiffs } : {}),
    ...(preview.pathDiff ? { pathDiff: preview.pathDiff } : {}),
    ...(preview.proposedCrawlerData ? { proposedCrawlerData: preview.proposedCrawlerData } : {}),
    ...(preview.imageAlternatives ? { imageAlternatives: preview.imageAlternatives } : {}),
  }));

export const beginMaintenancePreviewRequest = (): void =>
  useMaintenanceStore.setState({ previewPending: true, executeDialogOpen: false });
export const setMaintenancePreviewPending = (previewPending: boolean): void =>
  useMaintenanceStore.setState({ previewPending });
export const clearMaintenancePreviewResults = (): void => useMaintenanceStore.setState(previewState());
export const invalidateMaintenancePreview = (): void =>
  useMaintenanceStore.setState((state) => ({
    ...previewState(),
    ...(state.executionStatus === "idle" ? executionState() : {}),
  }));
export const cancelMaintenancePreviewFlow = (): void =>
  useMaintenanceStore.setState({ ...previewState(), ...executionState() });

export const applyMaintenancePreviewResult = (result: MaintenancePreviewResult): void =>
  useMaintenanceStore.setState((state) => {
    const previewResults = Object.fromEntries(result.items.map((item) => [item.fileId, item]));
    return {
      ...executionState(),
      previewPending: false,
      previewResults,
      fieldSelections: {},
      imageSelections: {},
      executeDialogOpen: false,
      activeId:
        state.activeId && previewResults[state.activeId] ? state.activeId : (result.items[0]?.fileId ?? state.activeId),
    };
  });

export const applyMaintenanceScanResult = (entries: LocalScanEntry[], dirPath: string): void => {
  useMaintenanceStore.getState().setEntries(entries, dirPath);
  useMaintenanceStore.setState({ ...previewState(), ...executionState() });
};

export const changeMaintenancePreset = (presetId: MaintenancePresetId): void => {
  invalidateMaintenancePreview();
  useMaintenanceStore.setState({ presetId });
};

export const toggleMaintenanceSelectedIds = (ids: string[]): void => {
  const state = useMaintenanceStore.getState();
  if (state.presetId !== "refresh_data" && state.presetId !== "rebuild_all") invalidateMaintenancePreview();
  useMaintenanceStore.getState().toggleSelectedIds(ids);
};

export const beginMaintenanceExecution = (fileIds: string[]): void =>
  useMaintenanceStore.getState().beginExecution({ fileIds });
export const resetMaintenanceSession = (): void => useMaintenanceStore.getState().reset();

export const applyMaintenanceExecutionItemResult = (payload: MaintenanceItemResult): void =>
  useMaintenanceStore.setState((state) => {
    if (payload.batchId && state.activeBatchId && payload.batchId !== state.activeBatchId) return state;
    const terminal = payload.status === "success" || payload.status === "failed" || payload.status === "skipped";
    const entries = terminal ? state.entries.filter((entry) => entry.fileId !== payload.fileId) : state.entries;
    const previewResults = { ...state.previewResults };
    const fieldSelections = { ...state.fieldSelections };
    const imageSelections = { ...state.imageSelections };
    if (terminal) {
      delete previewResults[payload.fileId];
      delete fieldSelections[payload.fileId];
      delete imageSelections[payload.fileId];
    }
    return {
      entries,
      selectedIds: terminal ? state.selectedIds.filter((id) => id !== payload.fileId) : state.selectedIds,
      activeId:
        state.activeId === payload.fileId
          ? (entries[0]?.fileId ?? null)
          : state.activeId && entries.some((entry) => entry.fileId === state.activeId)
            ? state.activeId
            : (entries[0]?.fileId ?? null),
      currentPath:
        state.entries.find((entry) => entry.fileId === payload.fileId)?.fileInfo.filePath ?? state.currentPath,
      previewResults,
      fieldSelections,
      imageSelections,
      itemResults: { ...state.itemResults, [payload.fileId]: { ...state.itemResults[payload.fileId], ...payload } },
      activeBatchId: payload.batchId ?? state.activeBatchId,
    };
  });

export const applyMaintenanceStatusSnapshot = (status: MaintenanceStatus): void =>
  useMaintenanceStore.setState({
    executionStatus: status.state,
    progressValue: status.totalEntries ? Math.round((status.completedEntries / status.totalEntries) * 100) : 0,
    progressCurrent: status.completedEntries,
    progressTotal: status.totalEntries,
  });

export const applyMaintenanceSessionSnapshot = (session: MaintenanceActiveSessionSnapshot | null): void => {
  if (!session) {
    resetMaintenanceSession();
    return;
  }
  const fileIdByPreviewId = new Map(session.previews.map((preview) => [preview.id, previewFileId(preview)]));
  const entries = session.previews.flatMap((preview) => {
    if (!preview.entry) return [];
    const fileId = fileIdByPreviewId.get(preview.id) as string;
    return [{ ...preview.entry, fileId, rootRef: { rootId: preview.rootId, relativePath: preview.relativePath } }];
  });
  const results = (session.currentBatch?.items ?? []).flatMap((item): MaintenanceItemResult[] => {
    const fileId = fileIdByPreviewId.get(item.selection.previewId);
    if (!fileId) return [];
    if (!item.result) return [{ fileId, batchId: session.currentBatch?.id, status: item.status }];
    return [
      {
        fileId,
        batchId: session.currentBatch?.id,
        status: item.result.status,
        ...(item.result.error ? { error: item.result.error } : {}),
        ...(item.result.crawlerData ? { crawlerData: item.result.crawlerData } : {}),
        ...(item.result.entry ? { updatedEntry: item.result.entry } : {}),
        ...(item.result.fieldDiffs ? { fieldDiffs: item.result.fieldDiffs } : {}),
        ...(item.result.unchangedFieldDiffs ? { unchangedFieldDiffs: item.result.unchangedFieldDiffs } : {}),
        ...(item.result.pathDiff ? { pathDiff: item.result.pathDiff } : {}),
      },
    ];
  });
  const executionStatus: ExecutionStatus =
    session.status === "paused"
      ? "paused"
      : session.status === "stopping"
        ? "stopping"
        : session.status === "queued" || session.status === "running"
          ? session.phase === "preview"
            ? "previewing"
            : "executing"
          : "idle";
  const activeFileIds = new Set(
    results
      .filter((result) => result.status === "pending" || result.status === "processing")
      .map((result) => result.fileId),
  );
  const previews = maintenanceSnapshotPreviewItems(session);
  useMaintenanceStore.setState((state) => ({
    snapshot: session,
    entries,
    selectedIds: ["executing", "paused", "stopping"].includes(executionStatus)
      ? entries.filter((entry) => activeFileIds.has(entry.fileId)).map((entry) => entry.fileId)
      : entries.map((entry) => entry.fileId),
    activeId:
      state.activeId && entries.some((entry) => entry.fileId === state.activeId)
        ? state.activeId
        : (entries[0]?.fileId ?? null),
    presetId: session.presetId,
    currentPath: entries[0]?.fileInfo.filePath ?? state.currentPath,
    previewPending: executionStatus === "previewing",
    previewResults: Object.fromEntries(previews.map((item) => [item.fileId, item])),
    fieldSelections: Object.fromEntries(
      Object.entries(session.draft.fieldSelections).flatMap(([id, value]) => {
        const fileId = fileIdByPreviewId.get(id);
        return fileId ? [[fileId, value]] : [];
      }),
    ),
    imageSelections: Object.fromEntries(
      Object.entries(session.draft.imageSelections).flatMap(([id, value]) => {
        const fileId = fileIdByPreviewId.get(id);
        return fileId ? [[fileId, value]] : [];
      }),
    ),
    executeDialogOpen: false,
    executionStatus,
    progressValue: session.totalEntries ? Math.round((session.completedEntries / session.totalEntries) * 100) : 0,
    progressCurrent: session.completedEntries,
    progressTotal: session.totalEntries,
    itemResults: Object.fromEntries(results.map((result) => [result.fileId, result])),
    activeBatchId: session.currentBatch?.id ?? null,
  }));
};
