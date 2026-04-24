import type { MaintenanceItemResult, MaintenanceStatus } from "@shared/types";
import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type MaintenanceExecutionStatus = MaintenanceStatus["state"];
const isDev = import.meta.env.DEV;

const createInitialState = () => ({
  executionStatus: "idle" as MaintenanceExecutionStatus,
  progressValue: 0,
  progressCurrent: 0,
  progressTotal: 0,
  itemResults: {} as Record<string, MaintenanceItemResult>,
});

export interface MaintenanceExecutionState {
  executionStatus: MaintenanceExecutionStatus;
  progressValue: number;
  progressCurrent: number;
  progressTotal: number;
  itemResults: Record<string, MaintenanceItemResult>;

  setExecutionStatus: (status: MaintenanceExecutionStatus) => void;
  setProgress: (value: number, current: number, total: number) => void;
  beginExecution: (input: { fileIds: string[] }) => void;
  rollbackExecutionStart: () => void;
  applyStatusSnapshot: (status: MaintenanceStatus) => void;
  applyItemResult: (payload: MaintenanceItemResult) => void;
  resetDerivedData: () => void;
  reset: () => void;
}

type PersistedMaintenanceExecutionState = Pick<MaintenanceExecutionState, "itemResults">;

const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const maintenanceExecutionStoreStorage = createJSONStorage<PersistedMaintenanceExecutionState>(() =>
  typeof sessionStorage !== "undefined" ? sessionStorage : noopStorage,
);

const partializeMaintenanceExecutionState = (state: MaintenanceExecutionState): PersistedMaintenanceExecutionState => ({
  itemResults: state.itemResults,
});

const mergePersistedMaintenanceExecutionState = (
  persisted: unknown,
  current: MaintenanceExecutionState,
): MaintenanceExecutionState => {
  const persistedState = (persisted ?? {}) as Partial<PersistedMaintenanceExecutionState>;

  return {
    ...current,
    ...persistedState,
    executionStatus: "idle",
    progressValue: 0,
    progressCurrent: 0,
    progressTotal: 0,
  };
};

const createMaintenanceExecutionState: StateCreator<MaintenanceExecutionState> = (set) => ({
  ...createInitialState(),

  setExecutionStatus: (executionStatus) => set({ executionStatus }),

  setProgress: (value, current, total) =>
    set({
      progressValue: Math.max(0, Math.min(100, value)),
      progressCurrent: current,
      progressTotal: total,
    }),

  beginExecution: ({ fileIds }) =>
    set((state) => {
      const nextResults = { ...state.itemResults };

      for (const fileId of fileIds) {
        nextResults[fileId] = {
          ...nextResults[fileId],
          fileId,
          status: "pending",
        };
      }

      return {
        executionStatus: "executing",
        progressValue: 0,
        progressCurrent: 0,
        progressTotal: fileIds.length,
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
        status.state === "previewing" ||
        status.state === "executing" ||
        status.state === "paused" ||
        status.state === "stopping"
          ? Math.max(state.progressValue, derivedProgress)
          : derivedProgress;

      return {
        executionStatus: status.state,
        progressValue: nextProgress,
        progressCurrent: status.completedEntries,
        progressTotal: status.totalEntries,
      };
    }),

  applyItemResult: (payload) =>
    set((state) => {
      const previousResult = state.itemResults[payload.fileId];

      return {
        itemResults: {
          ...state.itemResults,
          [payload.fileId]: {
            ...previousResult,
            ...payload,
          },
        },
      };
    }),

  resetDerivedData: () =>
    set({
      executionStatus: "idle",
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      itemResults: {},
    }),

  reset: () =>
    set({
      ...createInitialState(),
    }),
});

export const useMaintenanceExecutionStore = isDev
  ? create<MaintenanceExecutionState>()(
      persist(createMaintenanceExecutionState, {
        name: "maintenance-execution-store",
        storage: maintenanceExecutionStoreStorage,
        partialize: partializeMaintenanceExecutionState,
        merge: mergePersistedMaintenanceExecutionState,
      }),
    )
  : create<MaintenanceExecutionState>()(createMaintenanceExecutionState);
