import type { ScrapeLiveItemDto, ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";
import type { ScrapeResult } from "@mdcz/shared/types";
import { create } from "zustand";

export type ScrapeStatus = "idle" | "running" | "stopping" | "paused";
export type ScrapeOutcome = "completed" | "failed" | "stopped" | "interrupted" | null;

interface ScrapeState {
  snapshot: ScrapeRunSnapshotDto | null;
  retiredTaskIds: string[];
  pending: boolean;
  error: string | null;
  setSnapshot(snapshot: ScrapeRunSnapshotDto | null): void;
  setPending(pending: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

const initialState = () => ({
  snapshot: null as ScrapeRunSnapshotDto | null,
  retiredTaskIds: [] as string[],
  pending: false,
  error: null as string | null,
});

export const useScrapeStore = create<ScrapeState>()((set) => ({
  ...initialState(),
  setSnapshot: (snapshot) => {
    if (!snapshot) return;
    set((state) => {
      if (state.retiredTaskIds.includes(snapshot.task.id)) return state;
      const previous = state.snapshot;
      if (!previous || previous.task.id !== snapshot.task.id) {
        return {
          snapshot,
          retiredTaskIds: previous ? [...state.retiredTaskIds, previous.task.id] : state.retiredTaskIds,
          pending: false,
          error: null,
        };
      }

      const incomingById = new Map(snapshot.items.map((item) => [item.id, item]));
      const items = previous.items.map((item) => incomingById.get(item.id) ?? item);
      for (const item of snapshot.items) {
        if (!previous.items.some((candidate) => candidate.id === item.id)) items.push(item);
      }
      return { snapshot: { ...snapshot, items }, pending: false, error: null };
    });
  },
  setPending: (pending) => set({ pending }),
  setError: (error) => set({ error, pending: false }),
  reset: () =>
    set((state) => ({
      ...initialState(),
      retiredTaskIds: state.snapshot ? [...state.retiredTaskIds, state.snapshot.task.id] : state.retiredTaskIds,
    })),
}));

export const beginScrapeTask = (retryTaskId?: string): void =>
  useScrapeStore.setState((state) => ({
    snapshot: null,
    pending: true,
    error: null,
    retiredTaskIds: [...new Set([...state.retiredTaskIds, ...(state.snapshot ? [state.snapshot.task.id] : [])])].filter(
      (id) => id !== retryTaskId,
    ),
  }));

const liveItemToScrapeResult = (item: ScrapeLiveItemDto): ScrapeResult => ({
  ...(item.resultId ? { resultId: item.resultId } : {}),
  fileId: item.id,
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

const EMPTY_SCRAPE_RESULTS: ScrapeResult[] = [];
const scrapeResultsBySnapshot = new WeakMap<ScrapeRunSnapshotDto, ScrapeResult[]>();

export const selectScrapeSnapshot = (state: ScrapeState): ScrapeRunSnapshotDto | null => state.snapshot;
export const selectScrapeTaskId = (state: ScrapeState): string => state.snapshot?.task.id ?? "";

export const selectScrapeResults = (state: ScrapeState): ScrapeResult[] => {
  const snapshot = selectScrapeSnapshot(state);
  if (!snapshot) return EMPTY_SCRAPE_RESULTS;

  const cached = scrapeResultsBySnapshot.get(snapshot);
  if (cached) return cached;

  const results = snapshot.items.map(liveItemToScrapeResult);
  scrapeResultsBySnapshot.set(snapshot, results);
  return results;
};

export const selectScrapeStatus = (state: ScrapeState): ScrapeStatus => {
  const status = selectScrapeSnapshot(state)?.task.status;
  if (status === "paused" || status === "stopping") return status;
  return status === "queued" || status === "running" ? "running" : "idle";
};

/** How the run ended, so a stopped or interrupted run is not shown as a normal completion. */
export const selectScrapeOutcome = (state: ScrapeState): ScrapeOutcome => {
  const status = selectScrapeSnapshot(state)?.task.status;
  return status === "completed" || status === "failed" || status === "stopped" || status === "interrupted"
    ? status
    : null;
};

export const selectIsScraping = (state: ScrapeState): boolean => selectScrapeStatus(state) !== "idle";
export const selectScrapeHasWork = (state: ScrapeState): boolean =>
  selectIsScraping(state) || selectScrapeResults(state).length > 0;
export const selectScrapeProgress = (state: ScrapeState): number => selectScrapeSnapshot(state)?.progress.percent ?? 0;
export const selectFailedCount = (state: ScrapeState): number =>
  selectScrapeSnapshot(state)?.items.filter((item) => item.status === "failed").length ?? 0;
