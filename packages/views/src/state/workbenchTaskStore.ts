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
  refreshError: string | null;
  setHydrationState: (state: TaskHydrationState) => void;
  clearUncensoredConfirmation: () => void;
  setRefreshError: (error: string | null) => void;
  reset: () => void;
}

export const useWorkbenchTaskStore = create<WorkbenchTaskState>((set) => ({
  hydrationState: createTaskHydrationState(),
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
  reset: () =>
    set({
      hydrationState: createTaskHydrationState(),
      refreshError: null,
    }),
}));
