import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { applyScrapeStatusSnapshot, createOverviewInvalidationTracker } from "@renderer/hooks/useIpcSync";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  useScrapeStore.getState().reset();
});

describe("overview UI contract", () => {
  it("refreshes overview data when a scrape button-status cycle returns to idle", () => {
    const shouldInvalidate = createOverviewInvalidationTracker();

    expect(shouldInvalidate(false)).toBe(false);
    expect(shouldInvalidate(true)).toBe(false);
    expect(shouldInvalidate(true)).toBe(false);
    expect(shouldInvalidate(false)).toBe(true);
    expect(shouldInvalidate(false)).toBe(false);
  });

  it("preserves live in-file progress while a scrape is paused", () => {
    useScrapeStore.setState({
      scrapeStatus: "running",
      isScraping: true,
      progress: 42,
      total: 3,
      current: 1,
    });

    applyScrapeStatusSnapshot({
      state: "paused",
      running: true,
      totalFiles: 3,
      completedFiles: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });

    expect(useScrapeStore.getState()).toMatchObject({
      scrapeStatus: "paused",
      isScraping: true,
      progress: 42,
      total: 3,
      current: 1,
    });
  });

  it("hydrates paused progress when no live progress exists", () => {
    useScrapeStore.setState({ scrapeStatus: "running", isScraping: true, progress: 0, total: 3, current: 0 });

    applyScrapeStatusSnapshot({
      state: "paused",
      running: true,
      totalFiles: 3,
      completedFiles: 1,
      successCount: 1,
      failedCount: 0,
      skippedCount: 0,
    });

    expect(useScrapeStore.getState()).toMatchObject({ total: 3, current: 1 });
    expect(useScrapeStore.getState().progress).toBeCloseTo(100 / 3);
  });
});
