import type { FieldDiff, MaintenancePreviewItem, MaintenancePreviewResult } from "@mdcz/shared/types";
import { create, type StateCreator } from "zustand";

export type MaintenanceFieldSelectionSide = "old" | "new";

const createInitialState = () => ({
  previewPending: false,
  previewResults: {} as Record<string, MaintenancePreviewItem>,
  fieldSelections: {} as Record<string, Record<string, MaintenanceFieldSelectionSide>>,
  imageSelections: {} as Record<string, Record<string, string>>,
  executeDialogOpen: false,
});

export interface MaintenancePreviewState {
  previewPending: boolean;
  previewResults: Record<string, MaintenancePreviewItem>;
  fieldSelections: Record<string, Record<string, MaintenanceFieldSelectionSide>>;
  imageSelections: Record<string, Record<string, string>>;
  executeDialogOpen: boolean;

  beginPreviewRequest: () => void;
  clearPreviewResults: () => void;
  setPreviewPending: (pending: boolean) => void;
  setExecuteDialogOpen: (open: boolean) => void;
  setFieldSelection: (fileId: string, field: FieldDiff["field"], side: MaintenanceFieldSelectionSide) => void;
  setImageSelection: (fileId: string, field: string, value: string) => void;
  upsertPreviewItem: (item: MaintenancePreviewItem) => void;
  applyPreviewResult: (result: MaintenancePreviewResult) => void;
  removePreviewItem: (fileId: string) => void;
  reset: () => void;
}

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

  setImageSelection: (fileId, field, value) =>
    set((state) => ({
      imageSelections: {
        ...state.imageSelections,
        [fileId]: {
          ...state.imageSelections[fileId],
          [field]: value,
        },
      },
    })),

  upsertPreviewItem: (item) =>
    set((state) => ({
      previewPending: false,
      previewResults: {
        ...state.previewResults,
        [item.fileId]: item,
      },
    })),

  applyPreviewResult: (result) =>
    set({
      previewPending: false,
      previewResults: Object.fromEntries(result.items.map((item) => [item.fileId, item])),
      fieldSelections: {},
      imageSelections: {},
      executeDialogOpen: false,
    }),

  removePreviewItem: (fileId) =>
    set((state) => {
      if (!state.previewResults[fileId] && !state.fieldSelections[fileId] && !state.imageSelections[fileId])
        return state;
      const previewResults = { ...state.previewResults };
      const fieldSelections = { ...state.fieldSelections };
      const imageSelections = { ...state.imageSelections };
      delete previewResults[fileId];
      delete fieldSelections[fileId];
      delete imageSelections[fileId];
      return { previewResults, fieldSelections, imageSelections };
    }),

  reset: () => set(createInitialState()),
});

export const useMaintenancePreviewStore = create<MaintenancePreviewState>()(createMaintenancePreviewState);
