import type { ScrapeLiveItemDto, ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";
import type { ScrapeResult } from "@mdcz/shared/types";
import { create } from "zustand";

export type ScrapeStatus = "idle" | "running" | "stopping" | "paused";
export type ScrapeOutcome = "completed" | "failed" | "stopped" | "interrupted" | null;

interface ScrapeState {
  snapshot: ScrapeRunSnapshotDto | null;
  /** Earlier runs of the current retry chain, oldest first. */
  ancestors: ScrapeRunSnapshotDto[];
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
  ancestors: [] as ScrapeRunSnapshotDto[],
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
          ancestors:
            previous && snapshot.task.previousTaskId === previous.task.id ? [...state.ancestors, previous] : [],
          retiredTaskIds: previous ? [...state.retiredTaskIds, previous.task.id] : state.retiredTaskIds,
          error: null,
        };
      }

      if (snapshot.task.revision < previous.task.revision) {
        return state;
      }

      return { snapshot, error: null };
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
    pending: true,
    error: null,
    retiredTaskIds: retryTaskId ? state.retiredTaskIds.filter((id) => id !== retryTaskId) : state.retiredTaskIds,
  }));

export const runScrapeRequest = async <T>(request: () => Promise<T>, retryTaskId?: string): Promise<T> => {
  beginScrapeTask(retryTaskId);
  try {
    return await request();
  } catch (error) {
    useScrapeStore.getState().setError(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    useScrapeStore.getState().setPending(false);
  }
};

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
    : {}),
  assets: item.assets,
  uncensoredAmbiguous: item.uncensoredAmbiguous,
});

const EMPTY_SCRAPE_RESULTS: ScrapeResult[] = [];
// A retry run only holds the retried items, so the batch view overlays it on the earlier runs of its chain.
const scrapeResultsBySnapshot = new WeakMap<ScrapeRunSnapshotDto, ScrapeResult[]>();

export const selectScrapeSnapshot = (state: ScrapeState): ScrapeRunSnapshotDto | null => state.snapshot;
export const selectScrapeTaskId = (state: ScrapeState): string => state.snapshot?.task.id ?? "";

export const selectScrapeResults = (state: ScrapeState): ScrapeResult[] => {
  const snapshot = selectScrapeSnapshot(state);
  if (!snapshot) return EMPTY_SCRAPE_RESULTS;

  const cached = scrapeResultsBySnapshot.get(snapshot);
  if (cached) return cached;

  const items = new Map<string, ScrapeLiveItemDto>();
  for (const run of [...state.ancestors, snapshot]) {
    for (const item of run.items) items.set(`${item.rootId}\0${item.relativePath}`, item);
  }
  const results = [...items.values()].map(liveItemToScrapeResult);
  scrapeResultsBySnapshot.set(snapshot, results);
  return results;
};

export const selectScrapeStatus = (state: ScrapeState): ScrapeStatus => {
  const status = selectScrapeSnapshot(state)?.task.status;
  if (status === "paused" || status === "stopping") return status;
  return status === "queued" || status === "discovering" || status === "running" ? "running" : "idle";
};

/** Identifies terminal states that need distinct result messaging. */
export const selectScrapeOutcome = (state: ScrapeState): ScrapeOutcome => {
  const status = selectScrapeSnapshot(state)?.task.status;
  return status === "completed" || status === "failed" || status === "stopped" || status === "interrupted"
    ? status
    : null;
};

export const selectIsScraping = (state: ScrapeState): boolean => selectScrapeStatus(state) !== "idle";
export const selectScrapeHasWork = (state: ScrapeState): boolean => selectIsScraping(state) || state.snapshot !== null;
export const selectScrapeProgress = (state: ScrapeState): number => selectScrapeSnapshot(state)?.progress.percent ?? 0;
