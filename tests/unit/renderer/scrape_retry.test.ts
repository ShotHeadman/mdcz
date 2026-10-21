import { getT } from "@mdcz/views/i18n";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { retryScrapeSelection } from "@/api/scrape";
import { ipc } from "@/client/ipc";
import { buildFailedScrapeSnapshot, buildScrapeSnapshot } from "./scrapeTestSupport";

vi.mock("@/client/ipc", () => ({
  ipc: {
    scraper: {
      retry: vi.fn(),
    },
  },
}));

const retry = vi.mocked(ipc.scraper.retry);

describe("retryScrapeSelection", () => {
  beforeEach(() => {
    retry.mockReset();
    useScrapeStore.getState().reset();
    useScrapeStore.setState({ retiredTaskIds: [] });
  });

  it("retries this session's finished run id", async () => {
    useScrapeStore.getState().setSnapshot(
      buildFailedScrapeSnapshot({
        task: { ...buildFailedScrapeSnapshot().task, id: "original" },
      }),
    );
    retry.mockResolvedValue({
      taskId: "task-1",
      totalFiles: 2,
      snapshot: buildScrapeSnapshot(),
    });

    await expect(retryScrapeSelection()).resolves.toEqual({
      taskId: "task-1",
      totalFiles: 2,
      snapshot: buildScrapeSnapshot(),
    });

    expect(retry).toHaveBeenCalledWith("original");
  });

  it("requires a terminal run", async () => {
    useScrapeStore.getState().setSnapshot(
      buildScrapeSnapshot({
        task: { ...buildScrapeSnapshot().task, id: "running", status: "running", completedAt: null },
      }),
    );
    await expect(retryScrapeSelection()).rejects.toThrow(getT().desktop.scrapeTaskInProgress);

    expect(retry).not.toHaveBeenCalled();
  });

  it("requires a run in the scrape store", async () => {
    await expect(retryScrapeSelection()).rejects.toThrow(getT().desktop.noScrapeTaskToRetry);
    expect(retry).not.toHaveBeenCalled();
  });
});
