import type { LocalScanEntry, MaintenanceItemResult, MaintenancePresetId } from "@shared/types";
import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type MaintenanceFilter = "all" | "success" | "failed";

const isDev = import.meta.env.DEV;

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

type PersistedMaintenanceEntryState = Pick<
  MaintenanceEntryState,
  "entries" | "selectedIds" | "activeId" | "presetId" | "filter" | "currentPath" | "lastScannedDir"
>;

const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const maintenanceEntryStoreStorage = createJSONStorage<PersistedMaintenanceEntryState>(() =>
  typeof sessionStorage !== "undefined" ? sessionStorage : noopStorage,
);

const partializeMaintenanceEntryState = (state: MaintenanceEntryState): PersistedMaintenanceEntryState => ({
  entries: state.entries,
  selectedIds: state.selectedIds,
  activeId: state.activeId,
  presetId: state.presetId,
  filter: state.filter,
  currentPath: state.currentPath,
  lastScannedDir: state.lastScannedDir,
});

const mergePersistedMaintenanceEntryState = (
  persisted: unknown,
  current: MaintenanceEntryState,
): MaintenanceEntryState => {
  const persistedState = (persisted ?? {}) as Partial<PersistedMaintenanceEntryState>;
  const entries = persistedState.entries ?? current.entries;
  const activeId =
    persistedState.activeId && entries.some((entry) => entry.fileId === persistedState.activeId)
      ? persistedState.activeId
      : (entries[0]?.fileId ?? null);

  return {
    ...current,
    ...persistedState,
    activeId,
  };
};

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
      const updatedEntry = payload.status === "success" ? payload.updatedEntry : undefined;
      const nextEntries = updatedEntry
        ? state.entries.map((entry) => (entry.fileId === payload.fileId ? updatedEntry : entry))
        : state.entries;
      const currentEntry = updatedEntry ?? targetEntry;

      return {
        entries: nextEntries,
        currentPath:
          payload.status === "success"
            ? (currentEntry?.fileInfo.filePath ?? state.currentPath)
            : (targetEntry?.fileInfo.filePath ?? state.currentPath),
        activeId: state.activeId ?? payload.fileId,
      };
    }),

  reset: () =>
    set({
      ...createInitialState(),
    }),
});

export const useMaintenanceEntryStore = isDev
  ? create<MaintenanceEntryState>()(
      persist(createMaintenanceEntryState, {
        name: "maintenance-entry-store",
        storage: maintenanceEntryStoreStorage,
        partialize: partializeMaintenanceEntryState,
        merge: mergePersistedMaintenanceEntryState,
      }),
    )
  : create<MaintenanceEntryState>()(createMaintenanceEntryState);
