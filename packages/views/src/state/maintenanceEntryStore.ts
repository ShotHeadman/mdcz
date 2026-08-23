import type { LocalScanEntry, MaintenanceItemResult, MaintenancePresetId } from "@mdcz/shared/types";
import { create, type StateCreator } from "zustand";

export type MaintenanceFilter = "all" | "success" | "failed";

const toggleIdsInSelection = (selectedIds: string[], ids: string[]): string[] => {
  if (ids.length === 0) {
    return selectedIds;
  }

  return ids.every((id) => selectedIds.includes(id))
    ? selectedIds.filter((selectedId) => !ids.includes(selectedId))
    : Array.from(new Set([...selectedIds, ...ids]));
};

const createInitialState = () => ({
  entries: [] as LocalScanEntry[],
  selectedIds: [] as string[],
  activeId: null as string | null,
  presetId: "read_local" as MaintenancePresetId,
  filter: "all" as MaintenanceFilter,
  currentPath: "",
  lastScannedDir: "",
});

export interface MaintenanceEntryState {
  entries: LocalScanEntry[];
  selectedIds: string[];
  activeId: string | null;
  presetId: MaintenancePresetId;
  filter: MaintenanceFilter;
  currentPath: string;
  lastScannedDir: string;

  setPresetId: (presetId: MaintenancePresetId) => void;
  setEntries: (entries: LocalScanEntry[], dirPath: string) => void;
  setActiveId: (id: string | null) => void;
  toggleSelectedIds: (ids: string[]) => void;
  setFilter: (filter: MaintenanceFilter) => void;
  setCurrentPath: (path: string) => void;
  applyExecutionResult: (payload: MaintenanceItemResult) => void;
  reset: () => void;
}

const createMaintenanceEntryState: StateCreator<MaintenanceEntryState> = (set) => ({
  ...createInitialState(),

  setPresetId: (presetId) => set({ presetId }),

  setEntries: (entries, dirPath) =>
    set((state) => {
      const nextActiveId =
        state.activeId && entries.some((entry) => entry.fileId === state.activeId)
          ? state.activeId
          : (entries[0]?.fileId ?? null);

      return {
        entries,
        selectedIds: entries.map((entry) => entry.fileId),
        activeId: nextActiveId,
        currentPath: dirPath,
        lastScannedDir: dirPath,
        filter: "all",
      };
    }),

  setActiveId: (id) => set({ activeId: id }),

  toggleSelectedIds: (ids) =>
    set((state) => ({
      selectedIds: toggleIdsInSelection(state.selectedIds, ids),
    })),

  setFilter: (filter) => set({ filter }),

  setCurrentPath: (path) => set({ currentPath: path }),

  applyExecutionResult: (payload) =>
    set((state) => {
      const targetEntry = state.entries.find((entry) => entry.fileId === payload.fileId);
      if (payload.status === "success" || payload.status === "failed" || payload.status === "skipped") {
        const nextEntries = state.entries.filter((entry) => entry.fileId !== payload.fileId);
        const nextActiveId =
          state.activeId === payload.fileId
            ? (nextEntries[0]?.fileId ?? null)
            : state.activeId && nextEntries.some((entry) => entry.fileId === state.activeId)
              ? state.activeId
              : (nextEntries[0]?.fileId ?? null);
        return {
          entries: nextEntries,
          selectedIds: state.selectedIds.filter((id) => id !== payload.fileId),
          activeId: nextActiveId,
          currentPath: targetEntry?.fileInfo.filePath ?? state.currentPath,
        };
      }
      return {
        entries: state.entries,
        currentPath: targetEntry?.fileInfo.filePath ?? state.currentPath,
        activeId: state.activeId ?? payload.fileId,
      };
    }),

  reset: () =>
    set({
      ...createInitialState(),
    }),
});

export const useMaintenanceEntryStore = create<MaintenanceEntryState>()(createMaintenanceEntryState);
