import { MaintenanceSession } from "@mdcz/runtime/maintenance";
import { getWorkbenchSessionSnapshot, resetScrapeWorkbenchToSetup } from "@mdcz/views/adapters/workbenchSession";
import {
  changeMaintenancePreset,
  selectMaintenanceEntries,
  selectMaintenanceProgress,
  useMaintenanceStore,
} from "@mdcz/views/state/maintenanceStore";
import { selectScrapeResults, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { beforeEach, describe, expect, it } from "vitest";
import { buildFailedScrapeSnapshot, buildScrapeSnapshot } from "./scrapeTestSupport";

describe("workbench session scrape setup", () => {
  beforeEach(() => {
    useScrapeStore.getState().reset();
    useMaintenanceStore.getState().reset();
    useScrapeStore.setState({ retiredTaskIds: [] });
    useMaintenanceStore.setState({ retiredSessionIds: [] });
    useWorkbenchTaskStore.getState().reset();
    useUIStore.getState().setSelectedResultId(null);
    useUIStore.getState().setWorkbenchMode("scrape");
  });

  it("keeps the processing queue after a scrape completes in this window", () => {
    useScrapeStore.getState().setSnapshot(buildScrapeSnapshot());
    expect(getWorkbenchSessionSnapshot("scrape").showSetup).toBe(false);
    expect(selectScrapeResults(useScrapeStore.getState())).toHaveLength(1);
  });

  it("keeps the processing queue when the last scrape has failures", () => {
    useScrapeStore.getState().setSnapshot(buildFailedScrapeSnapshot());
    expect(getWorkbenchSessionSnapshot("scrape").showSetup).toBe(false);
    expect(selectScrapeResults(useScrapeStore.getState())).toHaveLength(1);
  });

  it("stays on setup after return even if live status is refreshed with null", () => {
    const snapshot = buildFailedScrapeSnapshot();
    useScrapeStore.getState().setSnapshot(snapshot);
    useUIStore.getState().setSelectedResultId("root-1:ABC-001.mp4");

    resetScrapeWorkbenchToSetup();
    expect(getWorkbenchSessionSnapshot("scrape").showSetup).toBe(true);
    expect(useUIStore.getState().selectedResultId).toBeNull();

    useScrapeStore.getState().setSnapshot(null);
    expect(getWorkbenchSessionSnapshot("scrape").showSetup).toBe(true);
    expect(selectScrapeResults(useScrapeStore.getState())).toEqual([]);
  });

  it("shows the start page when the renderer store is empty", () => {
    expect(getWorkbenchSessionSnapshot("scrape").showSetup).toBe(true);
    expect(selectScrapeResults(useScrapeStore.getState())).toEqual([]);
  });

  it.each([
    "read_local",
    "refresh_data",
  ] as const)("hydrates incremental %s previews and rejects retired sessions", (presetId) => {
    const refs = ["one.mp4", "two.mp4"].map((relativePath) => ({ rootId: "root-1", relativePath }));
    const session = new MaintenanceSession({ id: "maintenance-1", rootId: "root-1", presetId, refs, generation: 1 });
    session.startRunning(1);
    useMaintenanceStore.getState().setSnapshot(session.snapshot());
    expect(selectMaintenanceEntries(useMaintenanceStore.getState())).toEqual([]);

    for (const ref of refs) {
      session.commitPreview(1, {
        ...ref,
        status: "ready",
        error: null,
        fieldDiffs: [],
        unchangedFieldDiffs: [],
        pathDiff: null,
        proposedCrawlerData: null,
        entry: {
          ref,
          fileId: `${ref.rootId}:${ref.relativePath}`,
          fileInfo: {
            filePath: `/media/${ref.relativePath}`,
            fileName: ref.relativePath,
            extension: ".mp4",
            number: ref.relativePath,
            isSubtitled: false,
          },
          assets: { sceneImages: [], actorPhotos: [] },
          crawlerData: { title: ref.relativePath, number: ref.relativePath, actors: [], genres: [], scene_images: [] },
          currentDir: "/media",
        },
      });
      useMaintenanceStore.getState().setSnapshot(session.snapshot());
      if (ref.relativePath === "one.mp4") {
        expect(selectMaintenanceProgress(useMaintenanceStore.getState())).toBe(50);
        useMaintenanceStore.getState().toggleSelectedIds(["root-1:one.mp4"]);
      }
    }
    session.finish(1, "completed", null);
    const completed = session.snapshot();
    useMaintenanceStore.getState().setSnapshot(completed);
    expect(selectMaintenanceEntries(useMaintenanceStore.getState())).toHaveLength(2);
    expect(selectMaintenanceProgress(useMaintenanceStore.getState())).toBe(100);
    expect(useMaintenanceStore.getState().selectedIds).toEqual(["root-1:two.mp4"]);
    useMaintenanceStore.getState().setSnapshot({ ...completed, generation: 0, previews: [] });
    expect(useMaintenanceStore.getState().snapshot).toBe(completed);

    changeMaintenancePreset("organize_files");
    useMaintenanceStore.getState().setSnapshot(completed);
    expect(useMaintenanceStore.getState().snapshot).toBeNull();
    expect(useMaintenanceStore.getState().presetId).toBe("organize_files");
  });
});
