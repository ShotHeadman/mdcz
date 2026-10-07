import { create } from "zustand";

interface WorkbenchTaskState {
  refreshError: string | null;
  setRefreshError: (error: string | null) => void;
  reset: () => void;
}

export const useWorkbenchTaskStore = create<WorkbenchTaskState>((set) => ({
  refreshError: null,
  setRefreshError: (refreshError) => set({ refreshError }),
  reset: () => set({ refreshError: null }),
}));
