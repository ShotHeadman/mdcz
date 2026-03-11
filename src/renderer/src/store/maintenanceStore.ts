import type {
  LocalScanEntry,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewItem,
  MaintenancePreviewResult,
  MaintenanceStatus,
} from "@shared/types";
import { create } from "zustand";
import type { MaintenanceFieldSelectionSide } from "@/lib/maintenance";

export type MaintenanceFilter = "all" | "success" | "failed";

type MaintenanceExecutionStatus = MaintenanceStatus["state"];

const createPreviewResetState = () => ({
  previewPending: false,
  previewResults: {} as Record<string, MaintenancePreviewItem>,
  previewReadyCount: 0,
  previewBlockedCount: 0,
  fieldSelections: {} as Record<string, Record<string, MaintenanceFieldSelectionSide>>,
});

const getIdleStatusText = (entriesCount: number, emptyText = "就绪"): string => {
  return entriesCount > 0 ? `已扫描 ${entriesCount} 项` : emptyText;
};

const formatStatusText = (
  status: MaintenanceStatus,
  scannedEntries: number,
  previousText: string,
  previousExecutionStatus: MaintenanceExecutionStatus,
): string => {
  if (status.state === "scanning") {
    return "正在扫描目录...";
  }

  if (status.state === "executing") {
    return `已完成 ${status.completedEntries}/${status.totalEntries} · 成功 ${status.successCount} · 失败 ${status.failedCount}`;
  }

  if (status.state === "stopping") {
    return `正在停止 · 已完成 ${status.completedEntries}/${status.totalEntries}`;
  }

  if (
    status.totalEntries > 0 &&
    status.completedEntries < status.totalEntries &&
    (previousExecutionStatus === "stopping" || previousText.startsWith("已停止"))
  ) {
    return `已停止 · 已完成 ${status.completedEntries}/${status.totalEntries}`;
  }

  if (status.totalEntries > 0) {
    return `执行完成 · 成功 ${status.successCount} · 失败 ${status.failedCount}`;
  }

  if (scannedEntries > 0) {
    return `已扫描 ${scannedEntries} 项`;
  }

  return previousText || "就绪";
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
  previewPending: boolean;
  previewResults: Record<string, MaintenancePreviewItem>;
  previewReadyCount: number;
  previewBlockedCount: number;
  fieldSelections: Record<string, Record<string, MaintenanceFieldSelectionSide>>;
  itemResults: Record<string, MaintenanceItemResult>;

  setPresetId: (presetId: MaintenancePresetId) => void;
  setEntries: (entries: LocalScanEntry[], dirPath: string) => void;
  setActiveId: (id: string | null) => void;
  toggleSelected: (id: string) => void;
  setSelectedIds: (ids: string[]) => void;
  toggleSelectAll: (ids: string[]) => void;
  setFilter: (filter: MaintenanceFilter) => void;
  setExecutionStatus: (status: MaintenanceExecutionStatus) => void;
  setCurrentPath: (path: string) => void;
  setStatusText: (text: string) => void;
  setProgress: (value: number, current: number, total: number) => void;
  setPreviewPending: (pending: boolean) => void;
  applyPreviewResult: (result: MaintenancePreviewResult) => void;
  clearPreviewResults: () => void;
  setFieldSelection: (entryId: string, field: string, side: MaintenanceFieldSelectionSide) => void;
  beginExecution: (entryIds: string[]) => void;
  applyStatusSnapshot: (status: MaintenanceStatus) => void;
  applyItemResult: (payload: MaintenanceItemResult) => void;
  resetDerivedData: () => void;
  reset: () => void;
}

export const useMaintenanceStore = create<MaintenanceState>((set) => ({
  entries: [],
  selectedIds: [],
  activeId: null,
  presetId: "read_local",
  executionStatus: "idle",
  progressValue: 0,
  progressCurrent: 0,
  progressTotal: 0,
  filter: "all",
  currentPath: "",
  statusText: "就绪",
  lastScannedDir: "",
  previewPending: false,
  previewResults: {},
  previewReadyCount: 0,
  previewBlockedCount: 0,
  fieldSelections: {},
  itemResults: {},

  setPresetId: (presetId) =>
    set((state) => ({
      presetId,
      ...createPreviewResetState(),
      itemResults: {},
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      statusText: getIdleStatusText(state.entries.length),
    })),

  setEntries: (entries, dirPath) =>
    set((state) => {
      const nextActiveId =
        state.activeId && entries.some((entry) => entry.id === state.activeId)
          ? state.activeId
          : (entries[0]?.id ?? null);

      return {
        entries,
        selectedIds: [],
        activeId: nextActiveId,
        executionStatus: "idle",
        progressValue: 0,
        progressCurrent: 0,
        progressTotal: 0,
        currentPath: dirPath,
        statusText: entries.length > 0 ? `已扫描 ${entries.length} 项` : "未发现可维护项目",
        lastScannedDir: dirPath,
        ...createPreviewResetState(),
        itemResults: {},
        filter: "all",
      };
    }),

  setActiveId: (id) => set({ activeId: id }),

  toggleSelected: (id) =>
    set((state) => ({
      ...createPreviewResetState(),
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((value) => value !== id)
        : [...state.selectedIds, id],
    })),

  setSelectedIds: (ids) =>
    set({
      selectedIds: ids,
      ...createPreviewResetState(),
    }),

  toggleSelectAll: (ids) =>
    set((state) => {
      const everySelected = ids.length > 0 && ids.every((id) => state.selectedIds.includes(id));
      return {
        ...createPreviewResetState(),
        selectedIds: everySelected
          ? state.selectedIds.filter((id) => !ids.includes(id))
          : Array.from(new Set([...state.selectedIds, ...ids])),
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

  setPreviewPending: (pending) => set({ previewPending: pending }),

  applyPreviewResult: (result) =>
    set((state) => {
      const previewResults = Object.fromEntries(result.items.map((item) => [item.entryId, item]));

      return {
        previewPending: false,
        previewResults,
        previewReadyCount: result.readyCount,
        previewBlockedCount: result.blockedCount,
        fieldSelections: {},
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
          pathDiff: preview?.pathDiff,
        };
      }

      return {
        executionStatus: "executing",
        previewPending: false,
        progressValue: 0,
        progressCurrent: 0,
        progressTotal: entryIds.length,
        statusText: `正在执行 ${entryIds.length} 项...`,
        itemResults: nextResults,
      };
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
        statusText: formatStatusText(status, state.entries.length, state.statusText, state.executionStatus),
      };
    }),

  applyItemResult: (payload) =>
    set((state) => {
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
          [payload.entryId]: payload,
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
      statusText: getIdleStatusText(state.entries.length),
    })),

  reset: () =>
    set({
      entries: [],
      selectedIds: [],
      activeId: null,
      presetId: "read_local",
      executionStatus: "idle",
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      filter: "all",
      currentPath: "",
      statusText: "就绪",
      lastScannedDir: "",
      ...createPreviewResetState(),
      itemResults: {},
    }),
}));
