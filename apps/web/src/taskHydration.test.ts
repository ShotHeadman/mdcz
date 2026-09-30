import { selectIsScraping, selectScrapeTaskId, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFailedScrapeSnapshot,
  buildScrapeLiveItem,
  buildScrapeSnapshot,
} from "../../../tests/unit/renderer/scrapeTestSupport";
import { api } from "./client";
import { applyScrapeLiveRunsSnapshot, readScrapeRunsSnapshot, selectActiveLiveScrapeRun } from "./taskHydration";

describe("applyScrapeLiveRunsSnapshot", () => {
  afterEach(() => vi.restoreAllMocks());
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

  it("fetches and retains the terminal snapshot when the run leaves liveRuns", async () => {
    const status = "failed";
    const running = buildScrapeSnapshot({
      task: { ...buildScrapeSnapshot().task, id: "live-1", status: "running", completedAt: null },
      items: [buildScrapeLiveItem({ status: "processing" })],
    });
    applyScrapeLiveRunsSnapshot([running]);
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("live-1");

    const finished = buildFailedScrapeSnapshot({
      task: { ...buildFailedScrapeSnapshot().task, id: "live-1", status },
    });
    vi.spyOn(api.scrape, "liveRuns").mockResolvedValue({ runs: [] });
    const readTerminal = vi.spyOn(api.scrape, "snapshot").mockResolvedValue(finished);
    applyScrapeLiveRunsSnapshot((await readScrapeRunsSnapshot()).runs);
    expect(readTerminal).toHaveBeenCalledWith({ taskId: "live-1" });
    expect(selectIsScraping(useScrapeStore.getState())).toBe(false);
    expect(useScrapeStore.getState().snapshot?.items).toEqual(finished.items);
    await readScrapeRunsSnapshot();
    expect(readTerminal).toHaveBeenCalledOnce();
    applyScrapeLiveRunsSnapshot([]);
    expect(selectScrapeTaskId(useScrapeStore.getState())).toBe("live-1");
    expect(useScrapeStore.getState().snapshot?.task.status).toBe(status);
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
