import { create } from "zustand";

interface SettingsSavingState {
  /**
   * Number of in-flight auto-save requests. Settings page uses this to guard
   * profile-level actions (switch/reset/import/export) while pending writes
   * settle.
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
