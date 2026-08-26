import type { AmbiguousUncensoredItemDto } from "@mdcz/shared/serverDtos";
import { create } from "zustand";

export interface TaskHydrationState {
  activeScrapeTaskId: string;
  activeMaintenanceTaskId: string;
  latestScrapeStage: { taskId: string; stage: string; message: string; relativePath?: string } | null;
  latestTaskFailure: { taskId: string; message: string; error?: string | null } | null;
  uncensoredTaskId: string;
  ambiguousUncensoredItems: AmbiguousUncensoredItemDto[];
  shouldOpenUncensoredDialog: boolean;
}

export const createTaskHydrationState = (): TaskHydrationState => ({
  activeScrapeTaskId: "",
  activeMaintenanceTaskId: "",
  latestScrapeStage: null,
  latestTaskFailure: null,
  uncensoredTaskId: "",
  ambiguousUncensoredItems: [],
  shouldOpenUncensoredDialog: false,
});

interface WorkbenchTaskState {
  hydrationState: TaskHydrationState;
  scrapeStartPending: boolean;
  setHydrationState: (state: TaskHydrationState) => void;
  updateHydrationState: (updater: (state: TaskHydrationState) => TaskHydrationState) => void;
  setActiveScrapeTaskId: (taskId: string) => void;
  setActiveMaintenanceTaskId: (taskId: string) => void;
  resolveUncensoredTask: (taskId: string) => void;
  setScrapeStartPending: (pending: boolean) => void;
  reset: () => void;
}

export const useWorkbenchTaskStore = create<WorkbenchTaskState>((set) => ({
  hydrationState: createTaskHydrationState(),
  scrapeStartPending: false,
  setHydrationState: (hydrationState) => set({ hydrationState }),
  updateHydrationState: (updater) => set((state) => ({ hydrationState: updater(state.hydrationState) })),
  setActiveScrapeTaskId: (taskId) =>
    set((state) => ({
      hydrationState: { ...state.hydrationState, activeScrapeTaskId: taskId },
    })),
  setActiveMaintenanceTaskId: (taskId) =>
    set((state) => ({
      hydrationState: { ...state.hydrationState, activeMaintenanceTaskId: taskId },
    })),
  resolveUncensoredTask: (taskId) =>
    set((state) => ({
      hydrationState: {
        ...state.hydrationState,
        activeScrapeTaskId: taskId,
        ambiguousUncensoredItems: [],
        uncensoredTaskId: "",
      },
    })),
  setScrapeStartPending: (scrapeStartPending) => set({ scrapeStartPending }),
  reset: () =>
    set({
      hydrationState: createTaskHydrationState(),
      scrapeStartPending: false,
    }),
}));
