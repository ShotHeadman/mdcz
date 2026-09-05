import type { MaintenanceActiveSessionSnapshot, MaintenanceFieldSelectionSide } from "@mdcz/shared/maintenanceTasks";
import type {
  LocalScanEntry,
  MaintenanceItemResult,
  MaintenancePresetId,
  MaintenancePreviewItem,
  MaintenanceStatus,
} from "@mdcz/shared/types";
import { create } from "zustand";

export type MaintenanceFilter = "all" | "success" | "failed";
export type MaintenanceExecutionStatus = MaintenanceStatus["state"];

interface MaintenanceSnapshotView {
  entries: LocalScanEntry[];
  previewResults: Record<string, MaintenancePreviewItem>;
  itemResults: Record<string, MaintenanceItemResult>;
  fieldSelections: Record<string, Record<string, MaintenanceFieldSelectionSide>>;
}

interface MaintenanceState {
  snapshot: MaintenanceActiveSessionSnapshot | null;
  retiredSessionIds: string[];
  selectedIds: string[];
  activeId: string | null;
  presetId: MaintenancePresetId;
  filter: MaintenanceFilter;
  currentPath: string;
  pending: boolean;
  error: string | null;
  setSnapshot(snapshot: MaintenanceActiveSessionSnapshot | null): void;
  setPresetId(presetId: MaintenancePresetId): void;
  setActiveId(id: string | null): void;
  toggleSelectedIds(ids: string[]): void;
  setFilter(filter: MaintenanceFilter): void;
  setCurrentPath(path: string): void;
  setPending(pending: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

const previewFileId = (preview: MaintenanceActiveSessionSnapshot["previews"][number]): string =>
  preview.entry ? `${preview.rootId}:${preview.relativePath}` : preview.relativePath;

const EMPTY_MAINTENANCE_SNAPSHOT_VIEW: MaintenanceSnapshotView = {
  entries: [],
  previewResults: {},
  itemResults: {},
  fieldSelections: {},
};
const maintenanceSnapshotViews = new WeakMap<MaintenanceActiveSessionSnapshot, MaintenanceSnapshotView>();

const buildMaintenanceSnapshotView = (snapshot: MaintenanceActiveSessionSnapshot): MaintenanceSnapshotView => {
  const fileIdByPreviewId = new Map(snapshot.previews.map((preview) => [preview.id, previewFileId(preview)]));
  return {
    entries: snapshot.previews.flatMap((preview) =>
      preview.entry
        ? [
            {
              ...preview.entry,
              fileId: previewFileId(preview),
              ref: { rootId: preview.rootId, relativePath: preview.relativePath },
            },
          ]
        : [],
    ),
    previewResults: Object.fromEntries(
      snapshot.previews.map((preview) => {
        const item: MaintenancePreviewItem = {
          fileId: previewFileId(preview),
          previewId: preview.id,
          status:
            preview.status === "ready" || preview.status === "processing" || preview.status === "pending"
              ? preview.status
              : "blocked",
          ...(preview.error ? { error: preview.error } : {}),
          ...(preview.fieldDiffs.length ? { fieldDiffs: preview.fieldDiffs } : {}),
          ...(preview.unchangedFieldDiffs.length ? { unchangedFieldDiffs: preview.unchangedFieldDiffs } : {}),
          ...(preview.pathDiff ? { pathDiff: preview.pathDiff } : {}),
          ...(preview.proposedCrawlerData ? { proposedCrawlerData: preview.proposedCrawlerData } : {}),
          ...(preview.imageAlternatives ? { imageAlternatives: preview.imageAlternatives } : {}),
        };
        return [item.fileId, item];
      }),
    ),
    itemResults: snapshot.currentBatch
      ? Object.fromEntries(
          snapshot.currentBatch.items.flatMap((item): Array<[string, MaintenanceItemResult]> => {
            const fileId = fileIdByPreviewId.get(item.selection.previewId);
            if (!fileId) return [];
            const result = item.result;
            return [
              [
                fileId,
                {
                  fileId,
                  batchId: snapshot.currentBatch?.id,
                  status: result?.status ?? item.status,
                  ...(result?.error ? { error: result.error } : {}),
                  ...(result?.crawlerData ? { crawlerData: result.crawlerData } : {}),
                  ...(result?.entry ? { updatedEntry: result.entry } : {}),
                  ...(result?.fieldDiffs ? { fieldDiffs: result.fieldDiffs } : {}),
                  ...(result?.unchangedFieldDiffs ? { unchangedFieldDiffs: result.unchangedFieldDiffs } : {}),
                  ...(result?.pathDiff ? { pathDiff: result.pathDiff } : {}),
                },
              ],
            ];
          }),
        )
      : {},
    fieldSelections: Object.fromEntries(
      Object.entries(snapshot.draft.fieldSelections).flatMap(([previewId, selection]) => {
        const fileId = fileIdByPreviewId.get(previewId);
        return fileId ? [[fileId, selection]] : [];
      }),
    ),
  };
};

const selectMaintenanceSnapshotView = (state: MaintenanceState): MaintenanceSnapshotView => {
  const snapshot = state.snapshot;
  if (!snapshot) return EMPTY_MAINTENANCE_SNAPSHOT_VIEW;

  const cached = maintenanceSnapshotViews.get(snapshot);
  if (cached) return cached;

  const view = buildMaintenanceSnapshotView(snapshot);
  maintenanceSnapshotViews.set(snapshot, view);
  return view;
};

const initialState = () => ({
  snapshot: null as MaintenanceActiveSessionSnapshot | null,
  retiredSessionIds: [] as string[],
  selectedIds: [] as string[],
  activeId: null as string | null,
  presetId: "read_local" as MaintenancePresetId,
  filter: "all" as MaintenanceFilter,
  currentPath: "",
  pending: false,
  error: null as string | null,
});

export const selectMaintenanceEntries = (state: MaintenanceState): LocalScanEntry[] =>
  selectMaintenanceSnapshotView(state).entries;

export const selectMaintenancePreviewResults = (state: MaintenanceState): Record<string, MaintenancePreviewItem> =>
  selectMaintenanceSnapshotView(state).previewResults;

export const selectMaintenanceItemResults = (state: MaintenanceState): Record<string, MaintenanceItemResult> =>
  selectMaintenanceSnapshotView(state).itemResults;

export const selectMaintenanceExecutionStatus = (state: MaintenanceState): MaintenanceExecutionStatus => {
  const session = state.snapshot;
  if (!session) return state.pending ? "previewing" : "idle";
  if (session.status === "paused" || session.status === "stopping") return session.status;
  if (session.status === "queued" || session.status === "running") {
    return session.phase === "preview" ? "previewing" : "executing";
  }
  return "idle";
};

export const selectMaintenanceProgress = (state: MaintenanceState): number =>
  state.snapshot?.totalEntries ? Math.round((state.snapshot.completedEntries / state.snapshot.totalEntries) * 100) : 0;

export const selectMaintenanceFieldSelections = (state: MaintenanceState) =>
  selectMaintenanceSnapshotView(state).fieldSelections;

export const selectMaintenanceHasWork = (state: MaintenanceState): boolean => Boolean(state.snapshot) || state.pending;
export const selectMaintenanceSessionId = (state: MaintenanceState): string => state.snapshot?.id ?? "";

export const useMaintenanceStore = create<MaintenanceState>()((set) => ({
  ...initialState(),
  setSnapshot: (snapshot) =>
    set((state) => {
      if (snapshot && state.retiredSessionIds.includes(snapshot.id)) return state;
      if (snapshot && state.snapshot?.id === snapshot.id && snapshot.generation < state.snapshot.generation)
        return state;
      const retiredSessionIds =
        state.snapshot && state.snapshot.id !== snapshot?.id
          ? [...state.retiredSessionIds, state.snapshot.id]
          : state.retiredSessionIds;
      const entries = snapshot?.previews.map(previewFileId) ?? [];
      const previousEntries = new Set(state.snapshot?.previews.map(previewFileId));
      const selectedIds =
        state.snapshot?.id === snapshot?.id
          ? [
              ...state.selectedIds.filter((id) => entries.includes(id)),
              ...entries.filter((id) => !previousEntries.has(id)),
            ]
          : entries;
      return {
        snapshot,
        retiredSessionIds,
        presetId: snapshot?.presetId ?? state.presetId,
        selectedIds,
        activeId: state.activeId && entries.includes(state.activeId) ? state.activeId : (entries[0] ?? null),
        currentPath: snapshot?.previews[0]?.entry?.fileInfo.filePath ?? state.currentPath,
        pending: false,
        error: null,
      };
    }),
  setPresetId: (presetId) => set({ presetId }),
  setActiveId: (activeId) => set({ activeId }),
  toggleSelectedIds: (ids) =>
    set((state) => ({
      selectedIds: ids.every((id) => state.selectedIds.includes(id))
        ? state.selectedIds.filter((id) => !ids.includes(id))
        : [...new Set([...state.selectedIds, ...ids])],
    })),
  setFilter: (filter) => set({ filter }),
  setCurrentPath: (currentPath) => set({ currentPath }),
  setPending: (pending) => set({ pending }),
  setError: (error) => set({ error, pending: false }),
  reset: () =>
    set((state) => ({
      ...initialState(),
      retiredSessionIds: state.snapshot ? [...state.retiredSessionIds, state.snapshot.id] : state.retiredSessionIds,
    })),
}));

export const applyMaintenanceSessionSnapshot = (snapshot: MaintenanceActiveSessionSnapshot | null): void =>
  useMaintenanceStore.getState().setSnapshot(snapshot);
export const changeMaintenancePreset = (presetId: MaintenancePresetId): void =>
  useMaintenanceStore.setState((state) => ({
    presetId,
    retiredSessionIds: state.snapshot ? [...state.retiredSessionIds, state.snapshot.id] : state.retiredSessionIds,
    snapshot: null,
    selectedIds: [],
    activeId: null,
    error: null,
  }));
export const toggleMaintenanceSelectedIds = (ids: string[]): void =>
  useMaintenanceStore.getState().toggleSelectedIds(ids);
export const resetMaintenanceSession = (): void => useMaintenanceStore.getState().reset();
