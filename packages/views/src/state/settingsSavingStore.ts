import { create } from "zustand";

interface SettingsSavingState {
  /**
   * Number of in-flight auto-save requests. The settings route uses this to
   * guard profile switches while pending writes settle (replacing the legacy
   * `isDirty` guard that disappeared with explicit Save/Blocker removal).
   */
  inFlight: number;
  incrementInFlight: () => void;
  decrementInFlight: () => void;
}

export const useSettingsSavingStore = create<SettingsSavingState>((set) => ({
  inFlight: 0,
  incrementInFlight: () =>
    set((state) => ({
      inFlight: state.inFlight + 1,
    })),
  decrementInFlight: () =>
    set((state) => ({
      inFlight: Math.max(0, state.inFlight - 1),
    })),
}));
