import { useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import {
  applyMaintenanceRuntimeSnapshot,
  applyScrapeStatusSnapshot,
  createOverviewInvalidationTracker,
} from "@renderer/hooks/useIpcSync";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  useScrapeStore.getState().reset();
  useMaintenanceStore.getState().reset();
  useMaintenanceStore.getState().reset();
  useMaintenanceStore.getState().reset();
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

  it("preserves authoritative in-file progress while a scrape is paused", () => {
    useScrapeStore.getState().setScrapeStatus("running");
    useScrapeStore.getState().setScraping(true);
    useScrapeStore.getState().updateProgress(42, 100);

    applyScrapeStatusSnapshot({
      state: "paused",
      running: true,
      totalFiles: 3,
      completedFiles: 0,
      percent: 42,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });

    expect(useScrapeStore.getState()).toMatchObject({
      scrapeStatus: "paused",
      isScraping: true,
      progress: 42,
      total: 3,
      current: 0,
    });
  });

  it("hydrates paused progress when no live progress exists", () => {
    useScrapeStore.setState({ scrapeStatus: "running", isScraping: true, progress: 0, total: 3, current: 0 });

    applyScrapeStatusSnapshot({
      state: "paused",
      running: true,
      totalFiles: 3,
      completedFiles: 1,
      percent: 100 / 3,
      successCount: 1,
      failedCount: 0,
      skippedCount: 0,
    });

    expect(useScrapeStore.getState()).toMatchObject({ total: 3, current: 1 });
    expect(useScrapeStore.getState().progress).toBeCloseTo(100 / 3);
  });

  it("fails unfinished results when a running snapshot returns to idle", () => {
    useScrapeStore.getState().seedProcessingResults(["/media/ABC-123.mp4"]);
    useScrapeStore.getState().setScrapeStatus("running");
    useScrapeStore.getState().setScraping(true);

    applyScrapeStatusSnapshot({
      state: "idle",
      running: false,
      totalFiles: 1,
      completedFiles: 0,
      percent: 0,
      successCount: 0,
      failedCount: 1,
      skippedCount: 0,
    });

    expect(useScrapeStore.getState().results[0]).toMatchObject({
      status: "failed",
      error: "已停止或未完成",
    });
  });

  it("does not clear local maintenance scan entries before a backend session exists", () => {
    useMaintenanceStore.getState().setEntries(
      [
        {
          fileId: "entry-1",
          fileInfo: {
            filePath: "/media/ABC-123.mp4",
            fileName: "ABC-123.mp4",
            extension: ".mp4",
            number: "ABC-123",
            isSubtitled: false,
          },
          assets: { sceneImages: [], actorPhotos: [] },
          currentDir: "/media",
        },
      ],
      "/media",
    );

    useMaintenanceStore.setState({ executionStatus: "scanning" });
    applyMaintenanceRuntimeSnapshot(null);

    expect(useMaintenanceStore.getState().entries).toHaveLength(1);
    expect(useMaintenanceStore.getState().executionStatus).toBe("scanning");

    applyMaintenanceRuntimeSnapshot(null);
    expect(useMaintenanceStore.getState().entries).toHaveLength(1);
  });
});
