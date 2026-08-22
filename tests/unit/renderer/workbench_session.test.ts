import { buildFileId } from "@mdcz/shared/mediaIdentity";
import type { LocalScanEntry } from "@mdcz/shared/types";
import type { MaintenanceActionPort } from "@mdcz/views/adapters";
import {
  activateRetryScrapeTask,
  getWorkbenchSessionSnapshot,
  resolveWorkbenchMode,
  startMaintenanceFlow,
} from "@mdcz/views/adapters";
import { useMaintenanceEntryStore } from "@mdcz/views/state/maintenanceEntryStore";
import { useMaintenanceExecutionStore } from "@mdcz/views/state/maintenanceExecutionStore";
import { useMaintenancePreviewStore } from "@mdcz/views/state/maintenancePreviewStore";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { useUIStore } from "@mdcz/views/state/uiStore";
import { afterEach, describe, expect, it, vi } from "vitest";

const resetStores = () => {
  useScrapeStore.getState().reset();
  useUIStore.getState().setSelectedResultId(null);
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

  it("activates retry without clearing results and preserves the selected item under its new key", () => {
    const retryPath = "/library/ABC-001/ABC-001.mp4";
    useScrapeStore.setState({
      results: [
        {
          status: "success",
          fileId: "old-source-key",
          fileInfo: { ...createEntry().fileInfo, filePath: retryPath },
        },
        {
          status: "failed",
          fileId: "untouched",
          error: "keep me",
          fileInfo: { ...createEntry().fileInfo, filePath: "/library/KEEP-002.mp4" },
        },
      ],
    });
    useUIStore.getState().setSelectedResultId("old-source-key");

    activateRetryScrapeTask([retryPath]);

    expect(useScrapeStore.getState()).toMatchObject({
      isScraping: true,
      scrapeStatus: "running",
      current: 0,
      total: 0,
      results: [
        { fileId: buildFileId(retryPath), status: "processing" },
        { fileId: "untouched", status: "failed", error: "keep me" },
      ],
    });
    expect(useUIStore.getState().selectedResultId).toBe(buildFileId(retryPath));
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
