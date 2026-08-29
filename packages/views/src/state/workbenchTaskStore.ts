import type { AmbiguousUncensoredItemDto } from "@mdcz/shared/serverDtos";
import { create } from "zustand";

export interface TaskHydrationState {
  uncensoredTaskId: string;
  ambiguousUncensoredItems: AmbiguousUncensoredItemDto[];
  shouldOpenUncensoredDialog: boolean;
}

export const createTaskHydrationState = (): TaskHydrationState => ({
  uncensoredTaskId: "",
  ambiguousUncensoredItems: [],
  shouldOpenUncensoredDialog: false,
});

interface WorkbenchTaskState {
  hydrationState: TaskHydrationState;
  scrapeStartPending: boolean;
  refreshError: string | null;
  setHydrationState: (state: TaskHydrationState) => void;
  clearUncensoredConfirmation: () => void;
  setRefreshError: (error: string | null) => void;
  setScrapeStartPending: (pending: boolean) => void;
  reset: () => void;
}

export const useWorkbenchTaskStore = create<WorkbenchTaskState>((set) => ({
  hydrationState: createTaskHydrationState(),
  scrapeStartPending: false,
  refreshError: null,
  setHydrationState: (hydrationState) => set({ hydrationState }),
  clearUncensoredConfirmation: () =>
    set((state) => ({
      hydrationState: {
        ...state.hydrationState,
        ambiguousUncensoredItems: [],
        shouldOpenUncensoredDialog: false,
        uncensoredTaskId: "",
      },
    })),
  setRefreshError: (refreshError) => set({ refreshError }),
  setScrapeStartPending: (scrapeStartPending) => set({ scrapeStartPending }),
  reset: () =>
    set({
      hydrationState: createTaskHydrationState(),
      scrapeStartPending: false,
      refreshError: null,
    }),
}));
