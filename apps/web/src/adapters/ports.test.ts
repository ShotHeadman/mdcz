import type { ScanTaskDto } from "@mdcz/shared/serverDtos";
import { useWorkbenchTaskStore } from "@mdcz/shared/stores/workbenchTaskStore";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, setAdminToken } from "../client";
import { createWebDetailPort, createWebMaintenanceActionPort, createWebScrapeActionPort } from "./ports";

const originalLocalStorage = globalThis.localStorage;
const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  setAdminToken(undefined);
  useWorkbenchTaskStore.getState().reset();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
});

describe("web detail action port", () => {
  it("resolves root-relative image candidates through authenticated library assets", async () => {
    setAdminToken("token-1");
    const port = createWebDetailPort();
    const [poster, remote] = await port.resolveImageCandidates(
      ["JAV_output/ABC-001/poster.jpg", "https://img.example/poster.jpg"],
      undefined,
      {
        id: "root-1:ABC-001.mp4",
        number: "ABC-001",
        path: "ABC-001.mp4",
        status: "success",
      },
    );

    expect(poster).toBe("http://127.0.0.1:3838/api/library/assets/root-1/JAV_output/ABC-001/poster.jpg?token=token-1");
    expect(remote).toBe("https://img.example/poster.jpg");
  });

  it("resolves selected-maintenance absolute local image candidates relative to the media root", async () => {
    setAdminToken("token-1");
    const port = createWebDetailPort();
    const [poster] = await port.resolveImageCandidates(
      ["/srv/media/JAV_output/Actor A/GNI-006/poster.jpg"],
      "/srv/media/JAV_output/Actor A/GNI-006",
      {
        id: "root-1:JAV_output/Actor A/GNI-006/GNI-006.mp4",
        number: "GNI-006",
        path: "/srv/media/JAV_output/Actor A/GNI-006/GNI-006.mp4",
        status: "success",
      },
    );

    expect(poster).toBe(
      "http://127.0.0.1:3838/api/library/assets/root-1/JAV_output/Actor%20A/GNI-006/poster.jpg?token=token-1",
    );
  });
});

describe("web scrape action port", () => {
  it("enables file deletion only for root-relative targets and calls safe server delete", async () => {
    const deleteFile = vi.spyOn(api.scrape, "deleteFile").mockResolvedValue({
      ok: true,
      rootId: "root-1",
      relativePath: "ABC-001.mp4",
    });
    const port = createWebScrapeActionPort();
    const safeTargets = [
      { filePath: "ABC-001.mp4", ref: { rootId: "root-1", relativePath: "ABC-001.mp4" } },
      { filePath: "ABC-001-CD2.mp4", ref: { rootId: "root-1", relativePath: "ABC-001-CD2.mp4" } },
    ];

    expect(port.getDeleteFileAvailability?.([{ filePath: "/absolute/ABC-001.mp4" }])).toBe("hidden");
    expect(port.getDeleteFileAvailability?.(safeTargets)).toBe("enabled");

    await port.deleteFile(safeTargets);

    expect(deleteFile).toHaveBeenNthCalledWith(1, { rootId: "root-1", relativePath: "ABC-001.mp4" });
    expect(deleteFile).toHaveBeenNthCalledWith(2, { rootId: "root-1", relativePath: "ABC-001-CD2.mp4" });
  });

  it("rejects delete calls when any target lacks a root-relative ref", async () => {
    const port = createWebScrapeActionPort();

    await expect(
      port.deleteFile([
        { filePath: "ABC-001.mp4", ref: { rootId: "root-1", relativePath: "ABC-001.mp4" } },
        { filePath: "/absolute/ABC-001-CD2.mp4" },
      ]),
    ).rejects.toThrow("Web 删除文件需要媒体目录引用");
  });
});

const createEntry = (): LocalScanEntry => ({
  fileId: "root-1:ABC-001.mp4",
  rootRef: { rootId: "root-1", relativePath: "ABC-001.mp4" },
  fileInfo: {
    filePath: "ABC-001.mp4",
    fileName: "ABC-001.mp4",
    extension: ".mp4",
    number: "ABC-001",
    isSubtitled: false,
  },
  assets: { sceneImages: [], actorPhotos: [] },
  currentDir: "/media",
});

describe("web maintenance action port", () => {
  it("stores maintenance task id in shared workbench state and reuses it across port instances", async () => {
    const runningTask: ScanTaskDto = {
      id: "maintenance-task-1",
      kind: "maintenance",
      rootId: "root-1",
      rootDisplayName: "Media",
      status: "running",
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
      startedAt: "2026-05-12T00:00:00.000Z",
      completedAt: null,
      videoCount: 1,
      directoryCount: 0,
      error: null,
      videos: ["ABC-001.mp4"],
    };
    vi.spyOn(api.maintenance, "start").mockResolvedValue(runningTask);
    vi.spyOn(api.maintenance, "preview").mockResolvedValue({
      task: runningTask,
      items: [],
      confirmationToken: "maintenance:maintenance-task-1",
    });
    const pause = vi.spyOn(api.maintenance, "pause").mockResolvedValue({
      ...runningTask,
      status: "paused",
    });

    await createWebMaintenanceActionPort().preview([createEntry()], "refresh_data");
    await createWebMaintenanceActionPort().pause();

    expect(useWorkbenchTaskStore.getState().hydrationState.activeMaintenanceTaskId).toBe("maintenance-task-1");
    expect(pause).toHaveBeenCalledWith({ taskId: "maintenance-task-1" });
  });
});
