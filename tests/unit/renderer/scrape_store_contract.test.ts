import { selectScrapeHasWork, selectScrapeResults, useScrapeStore } from "@mdcz/views/state/scrapeStore";
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

  it("does not keep a completed scrape as workbench work unless it needs follow-up", () => {
    useScrapeStore.getState().setSnapshot(buildScrapeSnapshot());
    expect(selectScrapeHasWork(useScrapeStore.getState())).toBe(false);
    expect(selectScrapeResults(useScrapeStore.getState())).toEqual([]);

    useScrapeStore.getState().setSnapshot(buildFailedScrapeSnapshot());
    expect(selectScrapeHasWork(useScrapeStore.getState())).toBe(true);
    expect(selectScrapeResults(useScrapeStore.getState())).toHaveLength(1);
  });

  it("keeps a hidden failed run hidden when the same snapshot is applied again", () => {
    const snapshot = buildFailedScrapeSnapshot();
    useScrapeStore.getState().setSnapshot(snapshot);
    expect(selectScrapeResults(useScrapeStore.getState())).toHaveLength(1);

    useScrapeStore.getState().clearVisibleResults();
    expect(selectScrapeResults(useScrapeStore.getState())).toEqual([]);

    useScrapeStore.getState().setSnapshot(snapshot);
    expect(selectScrapeResults(useScrapeStore.getState())).toEqual([]);
    expect(useScrapeStore.getState().selection.hiddenRunId).toBe("task-1");
  });

  it("shows a newly started scrape even if a previous run was hidden", () => {
    useScrapeStore.getState().setSnapshot(buildFailedScrapeSnapshot());
    useScrapeStore.getState().clearVisibleResults();

    const next = buildScrapeSnapshot({
      task: { ...buildScrapeSnapshot().task, id: "task-2", status: "running", completedAt: null },
      items: [buildScrapeLiveItem({ id: "item-2", resultId: null, status: "processing" })],
    });
    useScrapeStore.getState().setSnapshot(next);

    expect(useScrapeStore.getState().selection.hiddenRunId).toBeNull();
    expect(selectScrapeResults(useScrapeStore.getState())).toHaveLength(1);
  });
});
