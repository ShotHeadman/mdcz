import type { MaintenanceActionPort } from "@mdcz/shared/adapters";
import { getWorkbenchSessionSnapshot, resolveWorkbenchMode, startMaintenanceFlow } from "@mdcz/shared/adapters";
import { useMaintenanceEntryStore } from "@mdcz/shared/stores/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@mdcz/shared/stores/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@mdcz/shared/stores/maintenancePreviewStore";
import { useScrapeStore } from "@mdcz/shared/stores/scrapeStore";
import { applyWebTaskUpdate, createTaskHydrationState } from "@mdcz/shared/taskHydration";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const resetStores = () => {
  useScrapeStore.getState().reset();
  useMaintenanceEntryStore.getState().reset();
  useMaintenanceExecutionStore.getState().reset();
  useMaintenancePreviewStore.getState().reset();
};

const createEntry = (): LocalScanEntry => ({
  fileId: "root-1:ABC-001.mp4",
  rootRef: { rootId: "root-1", relativePath: "ABC-001.mp4" },
  fileInfo: {
    filePath: "/media/ABC-001.mp4",
    fileName: "ABC-001.mp4",
    extension: ".mp4",
    number: "ABC-001",
    isSubtitled: false,
  },
  assets: { sceneImages: [], actorPhotos: [] },
  currentDir: "/media",
});

afterEach(resetStores);

describe("workbench session shared controller", () => {
  it("resolves maintenance intent to setup unless scrape is active", () => {
    expect(
      resolveWorkbenchMode({
        currentMode: "scrape",
        routeIntent: "maintenance",
        isScraping: false,
        scrapeHasWork: false,
        maintenanceHasWork: false,
      }),
    ).toBe("maintenance");

    expect(
      resolveWorkbenchMode({
        currentMode: "scrape",
        routeIntent: "maintenance",
        isScraping: true,
        scrapeHasWork: true,
        maintenanceHasWork: false,
      }),
    ).toBe("scrape");
  });

  it("derives setup visibility from shared scrape and maintenance stores", () => {
    expect(getWorkbenchSessionSnapshot("scrape").showSetup).toBe(true);
    useScrapeStore.getState().setScraping(true);
    useScrapeStore.getState().setScrapeStatus("running");
    expect(getWorkbenchSessionSnapshot("scrape").showSetup).toBe(false);
    resetStores();

    useMaintenanceEntryStore.getState().setEntries([createEntry()], "/media");
    expect(getWorkbenchSessionSnapshot("maintenance").showSetup).toBe(false);
  });

  it("applies web task updates through shared hydration state", () => {
    const state = applyWebTaskUpdate(
      {
        kind: "task",
        task: {
          id: "task-1",
          kind: "scrape",
          rootId: "root-1",
          rootDisplayName: "Media",
          status: "running",
          createdAt: "2026-05-04T00:00:00.000Z",
          updatedAt: "2026-05-04T00:00:00.000Z",
          startedAt: "2026-05-04T00:00:00.000Z",
          completedAt: null,
          videoCount: 1,
          directoryCount: 0,
          error: null,
          videos: ["ABC-001.mp4", "ABC-002.mp4"],
        },
      },
      createTaskHydrationState(),
    );

    expect(state.activeScrapeTaskId).toBe("task-1");
    expect(useScrapeStore.getState()).toMatchObject({
      isScraping: true,
      scrapeStatus: "running",
      current: 1,
      total: 2,
    });
  });

  it("starts maintenance through real port scan and shared store updates", async () => {
    const entry = createEntry();
    const port: MaintenanceActionPort = {
      openFolder: vi.fn(),
      play: vi.fn(),
      openNfo: vi.fn(),
      scanFiles: vi.fn(async () => ({ entries: [entry] })),
      preview: vi.fn(),
      execute: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const toast = {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    };

    await startMaintenanceFlow({
      filePaths: [entry.fileInfo.filePath],
      scanDir: "/media",
      presetId: "read_local",
      port,
      isScraping: false,
      toast,
      toErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    });

    expect(port.scanFiles).toHaveBeenCalledWith([entry.fileInfo.filePath], { scanDir: "/media" });
    expect(useMaintenanceEntryStore.getState().entries).toEqual([entry]);
    expect(toast.success).toHaveBeenCalledWith("本地读取完成，共 1 项");
  });
});
