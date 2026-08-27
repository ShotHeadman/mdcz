import { Website } from "@mdcz/shared/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readNfo, resolveNfoWritePath, retryScrapeSelection, updateNfo } from "@/api/manual";
import { ipc } from "@/client/ipc";

vi.mock("@/client/ipc", () => ({
  ipc: {
    file: {
      nfoRead: vi.fn(),
      nfoWrite: vi.fn(),
    },
    scraper: {
      getStatus: vi.fn(),
      retry: vi.fn(),
    },
  },
}));

const nfoRead = vi.mocked(ipc.file.nfoRead);
const nfoWrite = vi.mocked(ipc.file.nfoWrite);
const getStatus = vi.mocked(ipc.scraper.getStatus);
const retry = vi.mocked(ipc.scraper.retry);

describe("readNfo", () => {
  const crawlerData = {
    title: "Movie Title",
    number: "ABC-123",
    actors: [],
    genres: [],
    scene_images: [],
    website: Website.DMM,
  };

  beforeEach(() => {
    nfoRead.mockReset();
    nfoWrite.mockReset();
    getStatus.mockReset();
    retry.mockReset();
  });

  it("delegates configured naming resolution to the backend and uses its effective path", async () => {
    nfoRead.mockResolvedValueOnce({ data: crawlerData, nfoPath: "/media/ABC-123.nfo" });

    await expect(readNfo("/media/movie.nfo", "/media/ABC-123.mp4")).resolves.toEqual({
      data: {
        path: "/media/ABC-123.nfo",
        crawlerData,
      },
    });

    expect(nfoRead).toHaveBeenCalledWith("/media/movie.nfo", "/media/ABC-123.mp4");
    expect(nfoRead).toHaveBeenCalledTimes(1);
  });
});

describe("resolveNfoWritePath", () => {
  it("canonicalizes movie.nfo saves back to the video basename when video context exists", () => {
    expect(resolveNfoWritePath("/media/movie.nfo", "/media/ABC-123.mp4")).toBe("/media/ABC-123.nfo");
  });

  it("keeps movie.nfo when no video context exists", () => {
    expect(resolveNfoWritePath("/media/movie.nfo")).toBe("/media/movie.nfo");
  });
});

describe("updateNfo", () => {
  it("reuses the canonical basename nfo path before invoking the double-write backend", async () => {
    nfoWrite.mockResolvedValue({ success: true, nfoPath: "/media/ABC-123.nfo" });

    await updateNfo(
      "/media/movie.nfo",
      {
        title: "Movie Title",
        number: "ABC-123",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      },
      "/media/ABC-123.mp4",
    );

    expect(nfoWrite).toHaveBeenCalledWith("/media/ABC-123.nfo", expect.any(Object), "/media/ABC-123.mp4");
  });
});

describe("retryScrapeSelection", () => {
  beforeEach(() => {
    getStatus.mockReset();
    retry.mockReset();
  });

  it("retries the authoritative terminal run", async () => {
    getStatus.mockResolvedValue({
      task: {
        id: "original",
        kind: "scrape",
        rootId: "root",
        rootDisplayName: "root",
        status: "failed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
        videoCount: 0,
        directoryCount: 0,
        error: null,
      },
      progress: { percent: 100, completedItems: 2, totalItems: 2 },
      items: [],
      latestStage: null,
      logs: [],
      ambiguousUncensoredItems: [],
    });
    retry.mockResolvedValue({
      taskId: "task-1",
      totalFiles: 2,
      message: "重试任务已启动，共 2 个文件",
    });

    await expect(
      retryScrapeSelection(["/media/ABC-123.mp4", "/media/ABC-123-CD2.mp4"], { scrapeStatus: "idle" }),
    ).resolves.toEqual({
      data: {
        taskId: "task-1",
        totalFiles: 2,
        message: "重试任务已启动，共 2 个文件",
      },
    });

    expect(retry).toHaveBeenCalledWith("original");
  });

  it("requires a terminal run", async () => {
    getStatus.mockResolvedValue({
      task: {
        id: "running",
        kind: "scrape",
        rootId: "root",
        rootDisplayName: "root",
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
        videoCount: 0,
        directoryCount: 0,
        error: null,
      },
      progress: { percent: 0, completedItems: 0, totalItems: 1 },
      items: [],
      latestStage: null,
      logs: [],
      ambiguousUncensoredItems: [],
    });
    await expect(retryScrapeSelection("/media/ABC-123.mp4", { scrapeStatus: "running" })).rejects.toThrow(
      "当前刮削任务仍在进行",
    );

    expect(retry).not.toHaveBeenCalled();
  });
});
