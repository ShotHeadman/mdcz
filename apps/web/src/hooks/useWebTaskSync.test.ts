import type { ScrapeLiveRunsResponse } from "@mdcz/shared/serverDtos";
import type { MaintenanceClientSession } from "@mdcz/shared/types";
import { useMaintenanceExecutionStore } from "@mdcz/views/state/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@mdcz/views/state/maintenancePreviewStore";
import { applyMaintenanceClientSession } from "@mdcz/views/state/maintenanceSession";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../client";
import { applyWebTaskUpdate } from "../taskHydration";
import {
  applyWebTaskSnapshot,
  createMaintenanceSessionRefreshCoordinator,
  createScrapeLiveRunsRefreshCoordinator,
  hydrateActiveMaintenanceSession,
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

const maintenanceSession = (taskId: string): MaintenanceClientSession => ({
  taskId,
  batchId: "batch-1",
  presetId: "read_local",
  entries: [],
  preview: { items: [] },
  fieldSelections: {},
  imageSelections: {},
  status: {
    state: "executing",
    totalEntries: 1,
    completedEntries: 1,
    successCount: 1,
    failedCount: 0,
  },
  currentResults: [],
  recentResults: [],
});

describe("web task sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useScrapeStore.getState().reset();
    useWorkbenchTaskStore.getState().reset();
    applyMaintenanceClientSession(null);
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

  it("discards an older maintenance session read when a live event arrives first", async () => {
    const first = deferred<MaintenanceClientSession | null>();
    const current = maintenanceSession("maintenance-current");
    const read = vi
      .fn<() => Promise<MaintenanceClientSession | null>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(current);
    const applied: Array<MaintenanceClientSession | null> = [];
    const coordinator = createMaintenanceSessionRefreshCoordinator({
      read,
      apply: (session) => applied.push(session),
    });

    const refresh = coordinator.request();
    coordinator.notifyLiveUpdate();
    first.resolve(maintenanceSession("maintenance-stale"));
    await refresh;

    expect(read).toHaveBeenCalledTimes(2);
    expect(applied).toEqual([current]);
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

  it("does not let a generic task snapshot overwrite maintenance session state", () => {
    applyMaintenanceClientSession({
      ...maintenanceSession("maintenance-task"),
      status: {
        state: "idle",
        totalEntries: 1,
        completedEntries: 1,
        successCount: 1,
        failedCount: 0,
      },
    });
    const previous = {
      ...useWorkbenchTaskStore.getState().hydrationState,
      activeMaintenanceTaskId: "maintenance-task",
    };

    const next = applyWebTaskUpdate(
      {
        kind: "task",
        task: {
          id: "maintenance-task",
          kind: "maintenance",
          rootId: "root-1",
          rootDisplayName: "Media",
          status: "running",
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
          startedAt: "2026-08-25T00:00:00.000Z",
          completedAt: null,
          videoCount: 1,
          directoryCount: 1,
          error: null,
          continuity: "live",
        },
      },
      previous,
    );

    expect(next.activeMaintenanceTaskId).toBe("maintenance-task");
    expect(useMaintenanceExecutionStore.getState().executionStatus).toBe("idle");
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

  it("clears the cached maintenance session when the authoritative read returns null", async () => {
    applyMaintenanceClientSession(maintenanceSession("maintenance-task"));
    useWorkbenchTaskStore.getState().setActiveMaintenanceTaskId("maintenance-task");
    vi.mocked(api.maintenance.getActiveSession).mockResolvedValue(null);

    await hydrateActiveMaintenanceSession();

    expect(useWorkbenchTaskStore.getState().hydrationState.activeMaintenanceTaskId).toBe("");
    expect(useMaintenancePreviewStore.getState().previewResults).toEqual({});
    expect(useMaintenanceExecutionStore.getState()).toMatchObject({
      executionStatus: "idle",
      progressCurrent: 0,
      progressTotal: 0,
      itemResults: {},
    });
  });
});
