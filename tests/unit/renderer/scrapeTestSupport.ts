import type { ScrapeLiveItemDto, ScrapeRunSnapshotDto } from "@mdcz/shared/serverDtos";

const timestamp = "2026-01-01T00:00:00.000Z";

export const buildScrapeLiveItem = (overrides: Partial<ScrapeLiveItemDto> = {}): ScrapeLiveItemDto => ({
  id: "item-1",
  resultId: "result-1",
  rootId: "root-1",
  relativePath: "ABC-001.mp4",
  fileName: "ABC-001.mp4",
  status: "success",
  error: null,
  crawlerData: null,
  nfoRootId: null,
  nfoRelativePath: null,
  outputRootId: null,
  outputRelativePath: null,
  assets: [],
  manualUrl: null,
  uncensoredAmbiguous: false,
  ...overrides,
});

export const buildScrapeSnapshot = (overrides: Partial<ScrapeRunSnapshotDto> = {}): ScrapeRunSnapshotDto => ({
  task: {
    id: "task-1",
    kind: "scrape",
    rootId: "root-1",
    rootDisplayName: "Media",
    status: "completed",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    completedAt: timestamp,
    totalItems: 1,
    successCount: 1,
    failedCount: 0,
    skippedCount: 0,
    error: null,
    continuity: "final",
  },
  progress: { percent: 100, completedItems: 1, totalItems: 1 },
  items: [buildScrapeLiveItem()],
  latestStage: null,
  logs: [],
  ambiguousUncensoredItems: [],
  ...overrides,
});

export const buildFailedScrapeSnapshot = (overrides: Partial<ScrapeRunSnapshotDto> = {}): ScrapeRunSnapshotDto =>
  buildScrapeSnapshot({
    task: { ...buildScrapeSnapshot().task, status: "failed" },
    items: [buildScrapeLiveItem({ status: "failed", error: "scrape failed" })],
    ...overrides,
  });
