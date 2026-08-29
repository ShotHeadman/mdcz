import { getWorkbenchSessionSnapshot, resetScrapeWorkbenchToSetup } from "@mdcz/views/adapters/workbenchSession";
import { useMaintenanceStore } from "@mdcz/views/state/maintenanceStore";
import { selectScrapeResults, useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { beforeEach, describe, expect, it } from "vitest";
import { buildFailedScrapeSnapshot, buildScrapeSnapshot } from "./scrapeTestSupport";

describe("workbench session scrape setup", () => {
  beforeEach(() => {
    useScrapeStore.getState().reset();
    useMaintenanceStore.getState().reset();
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
});
