import {
  beginScrapeTask,
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
    useScrapeStore.setState({ retiredTaskIds: [] });
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
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("task-1");

    useScrapeStore.getState().setSnapshot(null);
    expect(selectScrapeHasWork(useScrapeStore.getState())).toBe(true);
    expect(selectScrapeResults(useScrapeStore.getState())).toHaveLength(1);

    useScrapeStore.getState().reset();
    expect(selectScrapeHasWork(useScrapeStore.getState())).toBe(false);
    expect(selectScrapeResults(useScrapeStore.getState())).toEqual([]);
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("");
    useScrapeStore.getState().setSnapshot(buildFailedScrapeSnapshot());
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("");
  });

  it("uses manifest item ids and keeps unaffected items when retry starts a new run", () => {
    const completed = buildScrapeSnapshot({
      task: { ...buildScrapeSnapshot().task, revision: 80, totalItems: 2, successCount: 1, failedCount: 1 },
      items: [
        buildScrapeLiveItem({ id: "item-success", status: "success" }),
        buildScrapeLiveItem({ id: "item-failed", resultId: "result-failed", status: "failed" }),
      ],
    });
    useScrapeStore.getState().setSnapshot(completed);

    useScrapeStore.getState().setSnapshot(
      buildScrapeSnapshot({
        task: { ...completed.task, id: "retry-run", status: "running", completedAt: null, revision: 1 },
        progress: { percent: 50, completedItems: 1, totalItems: 2 },
        items: [completed.items[0], buildScrapeLiveItem({ id: "item-failed", resultId: null, status: "processing" })],
      }),
    );

    expect(selectScrapeResults(useScrapeStore.getState()).map(({ fileId, status }) => ({ fileId, status }))).toEqual([
      { fileId: "item-success", status: "success" },
      { fileId: "item-failed", status: "processing" },
    ]);
  });

  it("keeps the previous snapshot when a retry request starts or fails", () => {
    const snapshot = buildFailedScrapeSnapshot();
    useScrapeStore.getState().setSnapshot(snapshot);

    beginScrapeTask(snapshot.task.id);
    expect(useScrapeStore.getState()).toMatchObject({ snapshot, pending: true, error: null });

    useScrapeStore.getState().setSnapshot({
      ...snapshot,
      task: { ...snapshot.task, revision: snapshot.task.revision + 1 },
    });
    expect(useScrapeStore.getState().pending).toBe(true);

    useScrapeStore.getState().setError("request failed");
    expect(useScrapeStore.getState()).toMatchObject({ pending: false, error: "request failed" });
  });

  it("does not let an older launch response overwrite a newer event snapshot", () => {
    const newer = buildScrapeSnapshot({
      task: { ...buildScrapeSnapshot().task, status: "running", revision: 2 },
      items: [buildScrapeLiveItem({ id: "item-1", status: "success" })],
    });
    const older = buildScrapeSnapshot({
      task: { ...newer.task, revision: 1 },
      items: [buildScrapeLiveItem({ id: "item-1", status: "processing" })],
    });

    useScrapeStore.getState().setSnapshot(newer);
    useScrapeStore.getState().setSnapshot(older);

    expect(useScrapeStore.getState().snapshot).toBe(newer);
  });
});
