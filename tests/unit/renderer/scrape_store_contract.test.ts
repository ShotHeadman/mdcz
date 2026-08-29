import {
  selectScrapeHasWork,
  selectScrapeResults,
  selectScrapeTaskId,
  useScrapeStore,
} from "@mdcz/views/state/scrapeStore";
import { beforeEach, describe, expect, it } from "vitest";
import { buildFailedScrapeSnapshot, buildScrapeLiveItem, buildScrapeSnapshot } from "./scrapeTestSupport";

describe("scrape store contract", () => {
  beforeEach(() => {
    useScrapeStore.getState().reset();
  });

  it("keeps the derived results snapshot stable until the scrape snapshot changes", () => {
    const initialState = useScrapeStore.getState();
    expect(selectScrapeResults(initialState)).toBe(selectScrapeResults(initialState));

    useScrapeStore.getState().setSnapshot(
      buildScrapeSnapshot({
        task: {
          ...buildScrapeSnapshot().task,
          status: "running",
          completedAt: null,
        },
        progress: { percent: 0, completedItems: 0, totalItems: 0 },
        items: [],
      }),
    );

    const activeState = useScrapeStore.getState();
    expect(selectScrapeResults(activeState)).toBe(selectScrapeResults(activeState));
  });

  it("keeps a completed scrape as workbench work until reset", () => {
    useScrapeStore.getState().setSnapshot(buildScrapeSnapshot());
    expect(selectScrapeHasWork(useScrapeStore.getState())).toBe(true);
    expect(selectScrapeResults(useScrapeStore.getState())).toHaveLength(1);

    useScrapeStore.getState().setSnapshot(null);
    expect(selectScrapeHasWork(useScrapeStore.getState())).toBe(true);
    expect(selectScrapeResults(useScrapeStore.getState())).toHaveLength(1);
  });

  it("does not erase this session's results when live status is null", () => {
    const snapshot = buildFailedScrapeSnapshot();
    useScrapeStore.getState().setSnapshot(snapshot);
    useScrapeStore.getState().setSnapshot(null);

    expect(useScrapeStore.getState().snapshot).toBe(snapshot);
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("task-1");
  });

  it("returns to an empty session after reset", () => {
    useScrapeStore.getState().setSnapshot(buildFailedScrapeSnapshot());
    useScrapeStore.getState().reset();

    expect(selectScrapeHasWork(useScrapeStore.getState())).toBe(false);
    expect(selectScrapeResults(useScrapeStore.getState())).toEqual([]);
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("");
  });

  it("exposes the current scrape task id from the store", () => {
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("");

    useScrapeStore.getState().setSnapshot(
      buildScrapeSnapshot({
        task: { ...buildScrapeSnapshot().task, id: "running-1", status: "running", completedAt: null },
        items: [buildScrapeLiveItem({ status: "processing" })],
      }),
    );
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("running-1");

    useScrapeStore.getState().setSnapshot(
      buildScrapeSnapshot({
        task: { ...buildScrapeSnapshot().task, id: "paused-1", status: "paused", completedAt: null },
        items: [buildScrapeLiveItem({ status: "processing" })],
      }),
    );
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("paused-1");

    useScrapeStore.getState().setSnapshot(buildScrapeSnapshot());
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("task-1");
  });
});
