import { useScrapeStore } from "@mdcz/shared/stores/scrapeStore";
import { useWorkbenchTaskStore } from "@mdcz/shared/stores/workbenchTaskStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, subscribeTaskRealtime } from "../client";
import { applyWebTaskSnapshot, hydrateActiveScrapeTaskResults } from "./useWebTaskSync";

vi.mock("../client", () => ({
  api: {
    scrape: {
      listResults: vi.fn(),
    },
    tasks: {
      list: vi.fn(),
    },
  },
  subscribeTaskRealtime: vi.fn(),
}));

describe("web task sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useScrapeStore.getState().reset();
    useWorkbenchTaskStore.getState().reset();
    vi.mocked(subscribeTaskRealtime).mockReturnValue(() => undefined);
  });

  it("hydrates active scrape task state through the shared stores", async () => {
    vi.mocked(api.tasks.list).mockResolvedValue({
      tasks: [
        {
          id: "task-1",
          kind: "scrape",
          rootId: "root-1",
          rootDisplayName: "Media",
          status: "running",
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z",
          startedAt: "2026-05-14T00:00:00.000Z",
          completedAt: null,
          videoCount: 1,
          directoryCount: 0,
          error: null,
          videos: ["ABC-001.mp4", "ABC-002.mp4"],
        },
      ],
    });

    await applyWebTaskSnapshot();

    expect(useWorkbenchTaskStore.getState().hydrationState.activeScrapeTaskId).toBe("task-1");
    expect(useScrapeStore.getState()).toMatchObject({
      isScraping: true,
      scrapeStatus: "running",
      current: 1,
      total: 2,
      progress: 50,
    });
  });

  it("hydrates active scrape results through shared task hydration", async () => {
    useWorkbenchTaskStore.getState().setActiveScrapeTaskId("task-1");
    vi.mocked(api.scrape.listResults).mockResolvedValue({
      results: [
        {
          id: "result-1",
          taskId: "task-1",
          rootId: "root-1",
          rootDisplayName: "Media",
          relativePath: "ABC-001.mp4",
          fileName: "ABC-001.mp4",
          status: "processing",
          error: null,
          crawlerData: null,
          nfoRelativePath: null,
          outputRelativePath: null,
          manualUrl: null,
          uncensoredAmbiguous: false,
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
    });

    await hydrateActiveScrapeTaskResults("task-1");

    expect(useScrapeStore.getState()).toMatchObject({
      results: [{ fileId: "root-1:ABC-001.mp4", status: "processing" }],
    });
  });
});
