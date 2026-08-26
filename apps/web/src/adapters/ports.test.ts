import type { ScanTaskDto } from "@mdcz/shared/serverDtos";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { DetailPanelAdapter } from "@mdcz/views/adapters";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  it("does not render the root-relative file path block in the WebUI detail panel", () => {
    const html = renderToStaticMarkup(
      createElement(DetailPanelAdapter, {
        port: createWebDetailPort(),
        item: {
          id: "root-1:ABC-001.mp4",
          number: "ABC-001",
          path: "ABC-001.mp4",
          status: "success",
          title: "ABC-001",
        },
      }),
    );

    expect(html).not.toContain("文件路径");
    expect(html).not.toContain("ABC-001.mp4");
    expect(html).not.toContain("播放");
    expect(html).not.toContain("打开文件夹");
    expect(html).toContain("编辑 NFO");
  });

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

  it("resolves selected-maintenance image candidates relative to the current video directory", async () => {
    setAdminToken("token-1");
    const port = createWebDetailPort();
    const [thumb, scene] = await port.resolveImageCandidates(
      ["thumb.jpg", "extrafanart/1.jpg"],
      "/srv/media/JAV_output/Actor A/GNI-006",
      {
        id: "root-1:JAV_output/Actor A/GNI-006/GNI-006.mp4",
        number: "GNI-006",
        path: "/srv/media/JAV_output/Actor A/GNI-006/GNI-006.mp4",
        status: "success",
      },
    );

    expect(thumb).toBe(
      "http://127.0.0.1:3838/api/library/assets/root-1/JAV_output/Actor%20A/GNI-006/thumb.jpg?token=token-1",
    );
    expect(scene).toBe(
      "http://127.0.0.1:3838/api/library/assets/root-1/JAV_output/Actor%20A/GNI-006/extrafanart/1.jpg?token=token-1",
    );
  });

  it("keeps root-relative image candidates anchored at the media root", async () => {
    setAdminToken("token-1");
    const port = createWebDetailPort();
    const [scene] = await port.resolveImageCandidates(
      ["JAV_output/Actor A/GNI-006/extrafanart/1.jpg"],
      "/srv/media/JAV_output/Actor A/GNI-006",
      {
        id: "root-1:JAV_output/Actor A/GNI-006/GNI-006.mp4",
        number: "GNI-006",
        path: "/srv/media/JAV_output/Actor A/GNI-006/GNI-006.mp4",
        status: "success",
      },
    );

    expect(scene).toBe(
      "http://127.0.0.1:3838/api/library/assets/root-1/JAV_output/Actor%20A/GNI-006/extrafanart/1.jpg?token=token-1",
    );
  });

  it("prepares and saves poster crops through result-scoped Web APIs", async () => {
    setAdminToken("token-1");
    const initialCrop = { x: 0.4, y: 0, width: 0.3, height: 0.9 };
    vi.spyOn(api.scrape, "posterCropSession").mockResolvedValue({
      sourceRelativePath: "JAV_output/ABC-001/thumb.png",
      targetRelativePath: "JAV_output/ABC-001/poster.png",
      width: 900,
      height: 500,
      initialCrop,
    });
    const save = vi.spyOn(api.scrape, "posterCropSave").mockResolvedValue({
      sourceRelativePath: "JAV_output/ABC-001/thumb.png",
      targetRelativePath: "JAV_output/ABC-001/poster.png",
      width: 900,
      height: 500,
      initialCrop,
      revision: "42",
    });
    const item = {
      id: "root-1:ABC-001.mp4",
      resultId: "result-1",
      number: "ABC-001",
      path: "ABC-001.mp4",
      status: "success" as const,
    };
    const port = createWebDetailPort();
    const session = await port.preparePosterCrop(item);
    const result = await port.savePosterCrop(item, initialCrop);

    expect(session.sourceUrl).toBe(
      "http://127.0.0.1:3838/api/library/assets/root-1/JAV_output/ABC-001/thumb.png?token=token-1",
    );
    expect(save).toHaveBeenCalledWith({ id: "result-1", crop: initialCrop });
    expect(result.posterUrl).toContain("poster.png");
    expect(result.posterUrl).toContain("revision=42");
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
