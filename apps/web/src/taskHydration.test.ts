import { selectScrapeTaskId, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildFailedScrapeSnapshot,
  buildScrapeLiveItem,
  buildScrapeSnapshot,
} from "../../../tests/unit/renderer/scrapeTestSupport";
import { applyScrapeLiveRunsSnapshot, selectActiveLiveScrapeRun } from "./taskHydration";

describe("applyScrapeLiveRunsSnapshot", () => {
  beforeEach(() => {
    useScrapeStore.getState().reset();
    useScrapeStore.setState({ retiredTaskIds: [] });
    useUIStore.getState().setSelectedResultId(null);
  });

  it("does not clear this session's finished results when liveRuns is empty", () => {
    const finished = buildScrapeSnapshot();
    useScrapeStore.getState().setSnapshot(finished);
    useUIStore.getState().setSelectedResultId("root-1:ABC-001.mp4");

    applyScrapeLiveRunsSnapshot([]);

    expect(useScrapeStore.getState().snapshot).toBe(finished);
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("task-1");
    expect(useUIStore.getState().selectedResultId).toBe("root-1:ABC-001.mp4");
  });

  it("leaves a fresh window empty when liveRuns is empty", () => {
    applyScrapeLiveRunsSnapshot([]);
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("");
    expect(useScrapeStore.getState().snapshot).toBeNull();
  });

  it("follows a live run and keeps that id after it finishes", () => {
    const running = buildScrapeSnapshot({
      task: { ...buildScrapeSnapshot().task, id: "live-1", status: "running", completedAt: null },
      items: [buildScrapeLiveItem({ status: "processing" })],
    });
    applyScrapeLiveRunsSnapshot([running]);
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("live-1");

    const finished = buildFailedScrapeSnapshot({
      task: { ...buildFailedScrapeSnapshot().task, id: "live-1" },
    });
    applyScrapeLiveRunsSnapshot([finished]);
    applyScrapeLiveRunsSnapshot([]);
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("live-1");
    expect(useScrapeStore.getState().snapshot?.task.status).toBe("failed");
  });
});

describe("selectActiveLiveScrapeRun", () => {
  it("retains the previously shown live run when it is still present", () => {
    const paused = buildScrapeSnapshot({
      task: { ...buildScrapeSnapshot().task, id: "paused-1", status: "paused", completedAt: null },
    });
    const running = buildScrapeSnapshot({
      task: { ...buildScrapeSnapshot().task, id: "running-1", status: "running", completedAt: null },
    });
    expect(selectActiveLiveScrapeRun([running, paused], "paused-1")?.task.id).toBe("paused-1");
  });
});
