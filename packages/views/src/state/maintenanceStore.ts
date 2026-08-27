import type { MaintenanceActiveSessionSnapshot } from "@mdcz/shared/maintenanceTasks";
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

interface MaintenanceState {
  snapshot: MaintenanceActiveSessionSnapshot | null;
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

const initialState = () => ({
  snapshot: null as MaintenanceActiveSessionSnapshot | null,
  selectedIds: [] as string[],
  activeId: null as string | null,
  presetId: "read_local" as MaintenancePresetId,
  filter: "all" as MaintenanceFilter,
  currentPath: "",
  pending: false,
  error: null as string | null,
});

const previewFileId = (preview: MaintenanceActiveSessionSnapshot["previews"][number]): string =>
  preview.entry?.rootRef
    ? `${preview.rootId}:${preview.relativePath}`
    : (preview.entry?.fileId ?? preview.relativePath);

export const selectMaintenanceEntries = (state: MaintenanceState): LocalScanEntry[] =>
  state.snapshot?.previews.flatMap((preview) =>
    preview.entry
      ? [
          {
            ...preview.entry,
            fileId: previewFileId(preview),
            rootRef: { rootId: preview.rootId, relativePath: preview.relativePath },
          },
        ]
      : [],
  ) ?? [];

export const selectMaintenancePreviewResults = (state: MaintenanceState): Record<string, MaintenancePreviewItem> =>
  Object.fromEntries(
    (state.snapshot?.previews ?? []).map((preview) => {
      const item: MaintenancePreviewItem = {
        fileId: previewFileId(preview),
        previewId: preview.id,
        taskId: preview.taskId,
        status: preview.status === "ready" ? "ready" : "blocked",
        ...(preview.error ? { error: preview.error } : {}),
        ...(preview.fieldDiffs.length ? { fieldDiffs: preview.fieldDiffs } : {}),
        ...(preview.unchangedFieldDiffs.length ? { unchangedFieldDiffs: preview.unchangedFieldDiffs } : {}),
        ...(preview.pathDiff ? { pathDiff: preview.pathDiff } : {}),
        ...(preview.proposedCrawlerData ? { proposedCrawlerData: preview.proposedCrawlerData } : {}),
        ...(preview.imageAlternatives ? { imageAlternatives: preview.imageAlternatives } : {}),
      };
      return [item.fileId, item];
    }),
  );

export const selectMaintenanceItemResults = (state: MaintenanceState): Record<string, MaintenanceItemResult> => {
  if (!state.snapshot?.currentBatch) return {};
  const fileIdByPreviewId = new Map(state.snapshot.previews.map((preview) => [preview.id, previewFileId(preview)]));
  return Object.fromEntries(
    state.snapshot.currentBatch.items.flatMap((item): Array<[string, MaintenanceItemResult]> => {
      const fileId = fileIdByPreviewId.get(item.selection.previewId);
      if (!fileId) return [];
      const result = item.result;
      return [
        [
          fileId,
          {
            fileId,
            batchId: state.snapshot?.currentBatch?.id,
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
  );
};

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

export const selectMaintenanceFieldSelections = (state: MaintenanceState) => {
  if (!state.snapshot) return {};
  const fileIdByPreviewId = new Map(state.snapshot.previews.map((preview) => [preview.id, previewFileId(preview)]));
  return Object.fromEntries(
    Object.entries(state.snapshot.draft.fieldSelections).flatMap(([previewId, selection]) => {
      const fileId = fileIdByPreviewId.get(previewId);
      return fileId ? [[fileId, selection]] : [];
    }),
  );
};

export const selectMaintenanceHasWork = (state: MaintenanceState): boolean => Boolean(state.snapshot) || state.pending;

export const useMaintenanceStore = create<MaintenanceState>()((set) => ({
  ...initialState(),
  setSnapshot: (snapshot) =>
    set((state) => {
      const entries = snapshot?.previews.map(previewFileId) ?? [];
      const selectedIds =
        state.snapshot?.id === snapshot?.id ? state.selectedIds.filter((id) => entries.includes(id)) : entries;
      return {
        snapshot,
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
  reset: () => set(initialState()),
}));

export const applyMaintenanceSessionSnapshot = (snapshot: MaintenanceActiveSessionSnapshot | null): void =>
  useMaintenanceStore.getState().setSnapshot(snapshot);
export const changeMaintenancePreset = (presetId: MaintenancePresetId): void =>
  useMaintenanceStore.setState({ presetId, snapshot: null, selectedIds: [], activeId: null, error: null });
export const toggleMaintenanceSelectedIds = (ids: string[]): void =>
  useMaintenanceStore.getState().toggleSelectedIds(ids);
export const resetMaintenanceSession = (): void => useMaintenanceStore.getState().reset();
