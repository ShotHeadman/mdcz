import type { ScrapeLiveRunsResponse } from "@mdcz/shared/serverDtos";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../client";
import {
  applyWebTaskSnapshot,
  createScrapeLiveRunsRefreshCoordinator,
  hydratePendingUncensoredConfirmation,
} from "./useWebTaskSync";

vi.mock("../client", () => ({
  api: {
    scrape: {
      liveRuns: vi.fn(),
      pendingUncensoredConfirmation: vi.fn(),
    },
    tasks: {
      list: vi.fn(),
    },
    maintenance: {
      getActiveSession: vi.fn(),
    },
  },
  subscribeTaskRealtime: vi.fn(),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const emptyRuns: ScrapeLiveRunsResponse = { runs: [] };

describe("web task sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useScrapeStore.getState().reset();
    useWorkbenchTaskStore.getState().reset();
  });

  it("serializes authority reads and immediately re-reads when dirtied in flight", async () => {
    const first = deferred<ScrapeLiveRunsResponse>();
    const read = vi
      .fn<() => Promise<ScrapeLiveRunsResponse>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(emptyRuns);
    const applied: ScrapeLiveRunsResponse[] = [];
    const coordinator = createScrapeLiveRunsRefreshCoordinator({
      read,
      apply: (response) => applied.push(response),
    });

    const initial = coordinator.request();
    const invalidatedWhileInFlight = coordinator.request();
    expect(read).toHaveBeenCalledTimes(1);

    first.resolve(emptyRuns);
    await Promise.all([initial, invalidatedWhileInFlight]);

    expect(read).toHaveBeenCalledTimes(2);
    expect(applied).toEqual([emptyRuns, emptyRuns]);
  });

  it("keeps a failed authority read dirty until a later signal retries it", async () => {
    const read = vi
      .fn<() => Promise<ScrapeLiveRunsResponse>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(emptyRuns);
    const applied: ScrapeLiveRunsResponse[] = [];
    const coordinator = createScrapeLiveRunsRefreshCoordinator({
      read,
      apply: (response) => applied.push(response),
    });

    await coordinator.request();
    expect(read).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([]);

    await coordinator.request();
    expect(read).toHaveBeenCalledTimes(2);
    expect(applied).toEqual([emptyRuns]);
  });

  it("keeps generic scrape history out of the live workbench stores", async () => {
    vi.mocked(api.tasks.list).mockResolvedValue({
      tasks: [
        {
          id: "history-task",
          kind: "scrape",
          rootId: "root-1",
          rootDisplayName: "Media",
          status: "failed",
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z",
          startedAt: null,
          completedAt: null,
          videoCount: 0,
          directoryCount: 0,
          error: "interrupted",
          continuity: "interrupted",
        },
      ],
    });

    await applyWebTaskSnapshot();

    expect(useWorkbenchTaskStore.getState().hydrationState.activeScrapeTaskId).toBe("");
    expect(useScrapeStore.getState().results).toEqual([]);
  });

  it("hydrates durable uncensored confirmation independently from live runs", async () => {
    vi.mocked(api.scrape.pendingUncensoredConfirmation).mockResolvedValue({
      items: [
        {
          id: "outcome-1",
          taskId: "task-1",
          ref: { rootId: "root-1", relativePath: "ABC-001.mp4" },
          fileId: "item-1",
          fileName: "ABC-001.mp4",
          number: "ABC-001",
          title: null,
          nfoRelativePath: null,
        },
      ],
    });

    await hydratePendingUncensoredConfirmation();

    expect(useWorkbenchTaskStore.getState().hydrationState).toMatchObject({
      uncensoredTaskId: "task-1",
      shouldOpenUncensoredDialog: true,
    });
  });
});
