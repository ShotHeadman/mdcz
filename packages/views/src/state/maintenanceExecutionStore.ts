import type { MaintenanceItemResult, MaintenanceStatus } from "@mdcz/shared/types";
import { create, type StateCreator } from "zustand";

type MaintenanceExecutionStatus = MaintenanceStatus["state"];

const createInitialState = () => ({
  executionStatus: "idle" as MaintenanceExecutionStatus,
  progressValue: 0,
  progressCurrent: 0,
  progressTotal: 0,
  itemResults: {} as Record<string, MaintenanceItemResult>,
  activeBatchId: null as string | null,
});

export interface MaintenanceExecutionState {
  executionStatus: MaintenanceExecutionStatus;
  progressValue: number;
  progressCurrent: number;
  progressTotal: number;
  itemResults: Record<string, MaintenanceItemResult>;
  activeBatchId: string | null;

  setExecutionStatus: (status: MaintenanceExecutionStatus) => void;
  setProgress: (value: number, current: number, total: number) => void;
  beginExecution: (input: { fileIds: string[] }) => void;
  rollbackExecutionStart: () => void;
  applyStatusSnapshot: (status: MaintenanceStatus) => void;
  applyItemResult: (payload: MaintenanceItemResult) => void;
  resetDerivedData: () => void;
  reset: () => void;
}

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
    set(() => {
      const nextResults: Record<string, MaintenanceItemResult> = {};

      for (const fileId of fileIds) {
        nextResults[fileId] = {
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
        activeBatchId: null,
      };
    }),

  rollbackExecutionStart: () =>
    set({
      executionStatus: "idle",
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      itemResults: {},
      activeBatchId: null,
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
      if (payload.batchId && state.activeBatchId && payload.batchId !== state.activeBatchId) return state;
      const previousResult = state.itemResults[payload.fileId];

      return {
        itemResults: {
          ...state.itemResults,
          [payload.fileId]: {
            ...previousResult,
            ...payload,
          },
        },
        activeBatchId: payload.batchId ?? state.activeBatchId,
      };
    }),

  resetDerivedData: () =>
    set({
      executionStatus: "idle",
      progressValue: 0,
      progressCurrent: 0,
      progressTotal: 0,
      itemResults: {},
      activeBatchId: null,
    }),

  reset: () =>
    set({
      ...createInitialState(),
    }),
});

export const useMaintenanceExecutionStore = create<MaintenanceExecutionState>()(createMaintenanceExecutionState);
