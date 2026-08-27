import type { ScrapeLiveItemDto, ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";
import type { ScrapeResult } from "@mdcz/shared/types";
import { create } from "zustand";

export type ScrapeStatus = "idle" | "running" | "stopping" | "paused";

interface ScrapeState {
  snapshot: ScrapeRunSnapshotDto | null;
  selection: { hiddenRunId: string | null };
  pending: boolean;
  error: string | null;
  setSnapshot(snapshot: ScrapeRunSnapshotDto | null): void;
  setPending(pending: boolean): void;
  setError(error: string | null): void;
  clearVisibleResults(): void;
  reset(): void;
}

const initialState = () => ({
  snapshot: null as ScrapeRunSnapshotDto | null,
  selection: { hiddenRunId: null as string | null },
  pending: false,
  error: null as string | null,
});

export const useScrapeStore = create<ScrapeState>()((set) => ({
  ...initialState(),
  setSnapshot: (snapshot) =>
    set((state) => ({
      snapshot,
      selection: snapshot?.task.id === state.selection.hiddenRunId ? state.selection : { hiddenRunId: null },
      pending: false,
      error: null,
    })),
  setPending: (pending) => set({ pending }),
  setError: (error) => set({ error, pending: false }),
  clearVisibleResults: () => set((state) => ({ selection: { hiddenRunId: state.snapshot?.task.id ?? null } })),
  reset: () => set(initialState()),
}));

const isVisible = (state: ScrapeState): boolean =>
  Boolean(state.snapshot && state.snapshot.task.id !== state.selection.hiddenRunId);

const liveItemToScrapeResult = (item: ScrapeLiveItemDto): ScrapeResult => ({
  ...(item.resultId ? { resultId: item.resultId } : {}),
  fileId: `${item.rootId}:${item.relativePath}`,
  rootId: item.rootId,
  relativePath: item.relativePath,
  fileName: item.fileName,
  status: item.status,
  ...(item.crawlerData ? { crawlerData: item.crawlerData } : {}),
  ...(item.error ? { error: item.error } : {}),
  ...(item.outputRootId && item.outputRelativePath
    ? { output: { rootId: item.outputRootId, relativePath: item.outputRelativePath } }
    : {}),
  ...(item.nfoRootId && item.nfoRelativePath
    ? { nfo: { rootId: item.nfoRootId, relativePath: item.nfoRelativePath } }
    : item.nfoRelativePath
      ? { nfo: { rootId: item.rootId, relativePath: item.nfoRelativePath } }
      : {}),
  assets: item.assets,
  uncensoredAmbiguous: item.uncensoredAmbiguous,
});

export const selectScrapeSnapshot = (state: ScrapeState): ScrapeRunSnapshotDto | null =>
  isVisible(state) ? state.snapshot : null;

export const selectScrapeResults = (state: ScrapeState): ScrapeResult[] =>
  selectScrapeSnapshot(state)?.items.map(liveItemToScrapeResult) ?? [];

export const selectScrapeStatus = (state: ScrapeState): ScrapeStatus => {
  const status = selectScrapeSnapshot(state)?.task.status;
  if (status === "paused" || status === "stopping") return status;
  return status === "queued" || status === "running" ? "running" : "idle";
};

export const selectIsScraping = (state: ScrapeState): boolean => selectScrapeStatus(state) !== "idle";
export const selectScrapeProgress = (state: ScrapeState): number => selectScrapeSnapshot(state)?.progress.percent ?? 0;
export const selectFailedCount = (state: ScrapeState): number =>
  selectScrapeSnapshot(state)?.items.filter((item) => item.status === "failed").length ?? 0;
