import type { ScrapeLiveItemDto, ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";
import type { ScrapeResult } from "@mdcz/shared/types";
import { create } from "zustand";

export type ScrapeStatus = "idle" | "running" | "stopping" | "paused";
export type ScrapeOutcome = "completed" | "failed" | "stopped" | "interrupted" | null;

interface ScrapeState {
  snapshot: ScrapeRunSnapshotDto | null;
  pending: boolean;
  error: string | null;
  setSnapshot(snapshot: ScrapeRunSnapshotDto | null): void;
  setPending(pending: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

const initialState = () => ({
  snapshot: null as ScrapeRunSnapshotDto | null,
  pending: false,
  error: null as string | null,
});

export const useScrapeStore = create<ScrapeState>()((set) => ({
  ...initialState(),
  setSnapshot: (snapshot) => {
    if (!snapshot) return;
    set({ snapshot, pending: false, error: null });
  },
  setPending: (pending) => set({ pending }),
  setError: (error) => set({ error, pending: false }),
  reset: () => set(initialState()),
}));

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
