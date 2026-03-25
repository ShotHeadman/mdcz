import type {
  LocalScanEntry,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewItem,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "@shared/types";
import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { MaintenanceFieldSelectionSide } from "@/lib/maintenance";
import {
  countMaintenanceDisplayItems,
  formatMaintenanceIdleStatusText,
  summarizeMaintenanceExecutionGroups,
} from "@/lib/maintenanceGrouping";

export type MaintenanceFilter = "all" | "success" | "failed";

type MaintenanceExecutionStatus = MaintenanceStatus["state"];

const isDev = import.meta.env.DEV;

const createPreviewResetState = () => ({
  executeDialogOpen: false,
  previewPending: false,
  previewResults: {} as Record<string, MaintenancePreviewItem>,
  fieldSelections: {} as Record<string, Record<string, MaintenanceFieldSelectionSide>>,
});

const getIdleStatusText = (entries: LocalScanEntry[], emptyText = "就绪"): string =>
  formatMaintenanceIdleStatusText(entries, emptyText);

const toggleIdsInSelection = (selectedIds: string[], ids: string[]): string[] => {
  if (ids.length === 0) {
    return selectedIds;
  }

  return ids.every((id) => selectedIds.includes(id))
    ? selectedIds.filter((selectedId) => !ids.includes(selectedId))
    : Array.from(new Set([...selectedIds, ...ids]));
};

const summarizeRawItemResults = (itemResults: Record<string, MaintenanceItemResult>) => {
  let successCount = 0;
  let failedCount = 0;
  let activeCount = 0;

  for (const result of Object.values(itemResults)) {
    if (result.status === "success") {
      successCount += 1;
      continue;
    }

    if (result.status === "failed") {
      failedCount += 1;
      continue;
    }

    activeCount += 1;
  }

  return {
    totalCount: successCount + failedCount + activeCount,
    completedCount: successCount + failedCount,
    successCount,
    failedCount,
    activeCount,
  };
};

const formatStatusText = (
  status: MaintenanceStatus,
  entries: LocalScanEntry[],
  itemResults: Record<string, MaintenanceItemResult>,
  previousText: string,
  previousExecutionStatus: MaintenanceExecutionStatus,
): string => {
  const wasStopping = previousExecutionStatus === "stopping" || previousText.startsWith("已停止");
  const wasExecuting = previousExecutionStatus === "executing" || previousText.startsWith("执行完成");
  const localSummary =
    entries.length > 0
      ? summarizeMaintenanceExecutionGroups(entries, itemResults)
      : summarizeRawItemResults(itemResults);
  const hasTerminalLocalSummary = localSummary.totalCount > 0 && localSummary.activeCount === 0;

  if (status.state === "scanning") {
    return "正在扫描目录...";
  }

  if (status.state === "executing") {
    return localSummary.totalCount > 0
      ? `已完成 ${localSummary.completedCount}/${localSummary.totalCount} · 成功 ${localSummary.successCount} · 失败 ${localSummary.failedCount}`
      : `已完成 ${status.completedEntries}/${status.totalEntries} · 成功 ${status.successCount} · 失败 ${status.failedCount}`;
  }

  if (status.state === "stopping") {
    return localSummary.totalCount > 0
      ? `正在停止 · 已完成 ${localSummary.completedCount}/${localSummary.totalCount}`
      : `正在停止 · 已完成 ${status.completedEntries}/${status.totalEntries}`;
  }

  if (wasStopping && (status.totalEntries > 0 || hasTerminalLocalSummary)) {
    return `已停止 · 成功 ${localSummary.successCount} · 失败/取消 ${localSummary.failedCount}`;
  }

  if (status.totalEntries > 0) {
    return localSummary.totalCount > 0
      ? `执行完成 · 成功 ${localSummary.successCount} · 失败 ${localSummary.failedCount}`
      : `执行完成 · 成功 ${status.successCount} · 失败 ${status.failedCount}`;
  }

  if (wasExecuting && hasTerminalLocalSummary) {
    return `执行完成 · 成功 ${localSummary.successCount} · 失败 ${localSummary.failedCount}`;
  }

  if (entries.length > 0) {
    return getIdleStatusText(entries);
  }

  return previousText || "就绪";
};

const createInitialState = () => ({
  entries: [] as LocalScanEntry[],
  selectedIds: [] as string[],
  activeId: null as string | null,
  presetId: "read_local" as MaintenancePresetId,
  executionStatus: "idle" as MaintenanceExecutionStatus,
  progressValue: 0,
  progressCurrent: 0,
  progressTotal: 0,
  filter: "all" as MaintenanceFilter,
  currentPath: "",
  statusText: "就绪",
  lastScannedDir: "",
  ...createPreviewResetState(),
  itemResults: {} as Record<string, MaintenanceItemResult>,
});

type PersistedMaintenanceState = Pick<
  MaintenanceState,
  | "entries"
  | "selectedIds"
  | "activeId"
  | "presetId"
  | "filter"
  | "currentPath"
  | "lastScannedDir"
  | "previewResults"
  | "fieldSelections"
  | "itemResults"
>;

const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const maintenanceStoreStorage = createJSONStorage<PersistedMaintenanceState>(() =>
  typeof sessionStorage !== "undefined" ? sessionStorage : noopStorage,
);

const partializeMaintenanceState = (state: MaintenanceState): PersistedMaintenanceState => ({
  entries: state.entries,
  selectedIds: state.selectedIds,
  activeId: state.activeId,
  presetId: state.presetId,
  filter: state.filter,
  currentPath: state.currentPath,
  lastScannedDir: state.lastScannedDir,
  previewResults: state.previewResults,
  fieldSelections: state.fieldSelections,
  itemResults: state.itemResults,
});

const mergePersistedMaintenanceState = (persisted: unknown, current: MaintenanceState): MaintenanceState => {
  const persistedState = (persisted ?? {}) as Partial<PersistedMaintenanceState>;
  const entries = persistedState.entries ?? current.entries;
  const activeId =
    persistedState.activeId && entries.some((entry) => entry.id === persistedState.activeId)
      ? persistedState.activeId
      : (entries[0]?.id ?? null);

  return {
    ...current,
    ...persistedState,
    activeId,
    executionStatus: "idle",
    progressValue: 0,
    progressCurrent: 0,
    progressTotal: 0,
    executeDialogOpen: false,
    previewPending: false,
    statusText: getIdleStatusText(entries),
  };
};

export interface MaintenanceState {
  entries: LocalScanEntry[];
  selectedIds: string[];
  activeId: string | null;
  presetId: MaintenancePresetId;
  executionStatus: MaintenanceExecutionStatus;
  progressValue: number;
  progressCurrent: number;
  progressTotal: number;
  filter: MaintenanceFilter;
  currentPath: string;
  statusText: string;
  lastScannedDir: string;
  executeDialogOpen: boolean;
  previewPending: boolean;
  previewResults: Record<string, MaintenancePreviewItem>;
  fieldSelections: Record<string, Record<string, MaintenanceFieldSelectionSide>>;
  itemResults: Record<string, MaintenanceItemResult>;

  setPresetId: (presetId: MaintenancePresetId) => void;
  setEntries: (entries: LocalScanEntry[], dirPath: string) => void;
  setActiveId: (id: string | null) => void;
  toggleSelectedIds: (ids: string[]) => void;
  setSelectedIds: (ids: string[]) => void;
  toggleSelectAll: (ids: string[]) => void;
  setFilter: (filter: MaintenanceFilter) => void;
  setExecutionStatus: (status: MaintenanceExecutionStatus) => void;
  setCurrentPath: (path: string) => void;
  setStatusText: (text: string) => void;
  setProgress: (value: number, current: number, total: number) => void;
  setExecuteDialogOpen: (open: boolean) => void;
  setPreviewPending: (pending: boolean) => void;
  applyPreviewResult: (result: MaintenancePreviewResult) => void;
  clearPreviewResults: () => void;
  setFieldSelection: (entryId: string, field: string, side: MaintenanceFieldSelectionSide) => void;
  beginExecution: (entryIds: string[]) => void;
  rollbackExecutionStart: () => void;
  applyStatusSnapshot: (status: MaintenanceStatus) => void;
  applyItemResult: (payload: MaintenanceItemResult) => void;
  resetDerivedData: () => void;
  reset: () => void;
}

const createMaintenanceState: StateCreator<MaintenanceState> = (set) => ({
  ...createInitialState(),

  setPresetId: (presetId) =>
    set((state) => ({
      presetId,
      ...createPreviewResetState(),
      itemResults: {},
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      statusText: getIdleStatusText(state.entries),
    })),

  setEntries: (entries, dirPath) =>
    set((state) => {
      const nextActiveId =
        state.activeId && entries.some((entry) => entry.id === state.activeId)
          ? state.activeId
          : (entries[0]?.id ?? null);
      const nextSelectedIds = entries.map((entry) => entry.id);

      return {
        entries,
        selectedIds: nextSelectedIds,
        activeId: nextActiveId,
        executionStatus: "idle",
        progressValue: 0,
        progressCurrent: 0,
        progressTotal: 0,
        currentPath: dirPath,
        statusText: getIdleStatusText(entries, "未发现可维护项目"),
        lastScannedDir: dirPath,
        ...createPreviewResetState(),
        itemResults: {},
        filter: "all",
      };
    }),

  setActiveId: (id) => set({ activeId: id }),

  toggleSelectedIds: (ids) =>
    set((state) => ({
      ...createPreviewResetState(),
      selectedIds: toggleIdsInSelection(state.selectedIds, ids),
    })),

  setSelectedIds: (ids) =>
    set({
      selectedIds: ids,
      ...createPreviewResetState(),
    }),

  toggleSelectAll: (ids) =>
    set((state) => {
      return {
        ...createPreviewResetState(),
        selectedIds: toggleIdsInSelection(state.selectedIds, ids),
      };
    }),

  setFilter: (filter) => set({ filter }),

  setExecutionStatus: (status) => set({ executionStatus: status }),

  setCurrentPath: (path) => set({ currentPath: path }),

  setStatusText: (text) => set({ statusText: text }),

  setProgress: (value, current, total) =>
    set({
      progressValue: Math.max(0, Math.min(100, value)),
      progressCurrent: current,
      progressTotal: total,
    }),

  setExecuteDialogOpen: (open) => set({ executeDialogOpen: open }),

  setPreviewPending: (pending) => set({ previewPending: pending }),

  applyPreviewResult: (result) =>
    set((state) => {
      const previewResults = Object.fromEntries(result.items.map((item) => [item.entryId, item]));

      return {
        previewPending: false,
        previewResults,
        fieldSelections: {},
        itemResults: {},
        activeId:
          state.activeId && previewResults[state.activeId]
            ? state.activeId
            : (result.items[0]?.entryId ?? state.activeId),
      };
    }),

  clearPreviewResults: () => set(createPreviewResetState()),

  setFieldSelection: (entryId, field, side) =>
    set((state) => ({
      fieldSelections: {
        ...state.fieldSelections,
        [entryId]: {
          ...state.fieldSelections[entryId],
          [field]: side,
        },
      },
    })),

  beginExecution: (entryIds) =>
    set((state) => {
      const nextResults = { ...state.itemResults };
      for (const entryId of entryIds) {
        const preview = state.previewResults[entryId];
        nextResults[entryId] = {
          ...nextResults[entryId],
          entryId,
          status: "pending",
          error: preview?.status === "blocked" ? preview.error : undefined,
          fieldDiffs: preview?.fieldDiffs,
          unchangedFieldDiffs: preview?.unchangedFieldDiffs,
          pathDiff: preview?.pathDiff,
        };
      }

      return {
        executionStatus: "executing",
        previewPending: false,
        progressValue: 0,
        progressCurrent: 0,
        progressTotal: entryIds.length,
        statusText: `正在执行 ${countMaintenanceDisplayItems(state.entries.filter((entry) => entryIds.includes(entry.id)))} 项...`,
        itemResults: nextResults,
      };
    }),

  rollbackExecutionStart: () =>
    set({
      executionStatus: "idle",
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      itemResults: {},
    }),

  applyStatusSnapshot: (status) =>
    set((state) => {
      const derivedProgress =
        status.totalEntries > 0 ? Math.round((status.completedEntries / status.totalEntries) * 100) : 0;
      const nextProgress =
        status.state === "executing" || status.state === "stopping"
          ? Math.max(state.progressValue, derivedProgress)
          : derivedProgress;

      return {
        executionStatus: status.state,
        progressValue: nextProgress,
        progressCurrent: status.completedEntries,
        progressTotal: status.totalEntries,
        statusText: formatStatusText(status, state.entries, state.itemResults, state.statusText, state.executionStatus),
      };
    }),

  applyItemResult: (payload) =>
    set((state) => {
      const previousResult = state.itemResults[payload.entryId];
      const targetEntry = state.entries.find((entry) => entry.id === payload.entryId);
      const updatedEntry = payload.status === "success" ? payload.updatedEntry : undefined;
      const nextEntries = updatedEntry
        ? state.entries.map((entry) => (entry.id === payload.entryId ? updatedEntry : entry))
        : state.entries;
      const currentEntry = updatedEntry ?? targetEntry;

      return {
        entries: nextEntries,
        itemResults: {
          ...state.itemResults,
          [payload.entryId]: {
            ...previousResult,
            ...payload,
          },
        },
        currentPath:
          payload.status === "success"
            ? (currentEntry?.videoPath ?? state.currentPath)
            : (targetEntry?.videoPath ?? state.currentPath),
        activeId: state.activeId ?? payload.entryId,
      };
    }),

  resetDerivedData: () =>
    set((state) => ({
      ...createPreviewResetState(),
      itemResults: {},
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      statusText: getIdleStatusText(state.entries),
    })),

  reset: () =>
    set({
      ...createInitialState(),
    }),
});

export const useMaintenanceStore = isDev
  ? create<MaintenanceState>()(
      persist(createMaintenanceState, {
        name: "maintenance-store",
        storage: maintenanceStoreStorage,
        partialize: partializeMaintenanceState,
        merge: mergePersistedMaintenanceState,
      }),
    )
  : create<MaintenanceState>()(createMaintenanceState);
