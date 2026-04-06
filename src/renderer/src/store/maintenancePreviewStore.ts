import type { FieldDiff, MaintenancePreviewItem, MaintenancePreviewResult } from "@shared/types";
import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { MaintenanceFieldSelectionSide } from "@/lib/maintenance";

const isDev = import.meta.env.DEV;

const createInitialState = () => ({
  previewPending: false,
  previewResults: {} as Record<string, MaintenancePreviewItem>,
  fieldSelections: {} as Record<string, Record<string, MaintenanceFieldSelectionSide>>,
  executeDialogOpen: false,
});

export interface MaintenancePreviewState {
  previewPending: boolean;
  previewResults: Record<string, MaintenancePreviewItem>;
  fieldSelections: Record<string, Record<string, MaintenanceFieldSelectionSide>>;
  executeDialogOpen: boolean;

  beginPreviewRequest: () => void;
  clearPreviewResults: () => void;
  setPreviewPending: (pending: boolean) => void;
  setExecuteDialogOpen: (open: boolean) => void;
  setFieldSelection: (fileId: string, field: FieldDiff["field"], side: MaintenanceFieldSelectionSide) => void;
  applyPreviewResult: (result: MaintenancePreviewResult) => void;
  reset: () => void;
}

type PersistedMaintenancePreviewState = Pick<MaintenancePreviewState, "previewResults" | "fieldSelections">;

const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const maintenancePreviewStoreStorage = createJSONStorage<PersistedMaintenancePreviewState>(() =>
  typeof sessionStorage !== "undefined" ? sessionStorage : noopStorage,
);

const partializeMaintenancePreviewState = (state: MaintenancePreviewState): PersistedMaintenancePreviewState => ({
  previewResults: state.previewResults,
  fieldSelections: state.fieldSelections,
});

const mergePersistedMaintenancePreviewState = (
  persisted: unknown,
  current: MaintenancePreviewState,
): MaintenancePreviewState => {
  const persistedState = (persisted ?? {}) as Partial<PersistedMaintenancePreviewState>;

  return {
    ...current,
    ...persistedState,
    previewPending: false,
    executeDialogOpen: false,
  };
};

const createMaintenancePreviewState: StateCreator<MaintenancePreviewState> = (set) => ({
  ...createInitialState(),

  beginPreviewRequest: () =>
    set((state) => ({
      ...state,
      previewPending: true,
      executeDialogOpen: false,
    })),

  clearPreviewResults: () => set(createInitialState()),

  setPreviewPending: (previewPending) => set({ previewPending }),

  setExecuteDialogOpen: (executeDialogOpen) => set({ executeDialogOpen }),

  setFieldSelection: (fileId, field, side) =>
    set((state) => ({
      fieldSelections: {
        ...state.fieldSelections,
        [fileId]: {
          ...state.fieldSelections[fileId],
          [field]: side,
        },
      },
    })),

  applyPreviewResult: (result) =>
    set({
      previewPending: false,
      previewResults: Object.fromEntries(result.items.map((item) => [item.fileId, item])),
      fieldSelections: {},
      executeDialogOpen: false,
    }),

  reset: () => set(createInitialState()),
});

export const useMaintenancePreviewStore = isDev
  ? create<MaintenancePreviewState>()(
      persist(createMaintenancePreviewState, {
        name: "maintenance-preview-store",
        storage: maintenancePreviewStoreStorage,
        partialize: partializeMaintenancePreviewState,
        merge: mergePersistedMaintenancePreviewState,
      }),
    )
  : create<MaintenancePreviewState>()(createMaintenancePreviewState);
