import { create } from "zustand";

interface UIState {
  selectedResultId: string | null;
  workbenchMode: "scrape" | "maintenance";

  setSelectedResultId: (id: string | null) => void;
  setWorkbenchMode: (mode: "scrape" | "maintenance") => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedResultId: null,
  workbenchMode: "scrape",

  setSelectedResultId: (id) => set({ selectedResultId: id }),
  setWorkbenchMode: (mode) => set({ workbenchMode: mode }),
}));
