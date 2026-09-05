import { Website } from "@mdcz/shared/enums";
import { useScrapeStore } from "@mdcz/views/state/scrapeStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readNfo, resolveNfoWritePath, retryScrapeSelection, startSelectedScrape, updateNfo } from "@/api/manual";
import { ipc } from "@/client/ipc";
import { buildFailedScrapeSnapshot, buildScrapeSnapshot } from "./scrapeTestSupport";

vi.mock("@/client/ipc", () => ({
  ipc: {
    file: {
      nfoRead: vi.fn(),
      nfoWrite: vi.fn(),
    },
    scraper: {
      getStatus: vi.fn(),
      retry: vi.fn(),
      start: vi.fn(),
    },
  },
}));

const nfoRead = vi.mocked(ipc.file.nfoRead);
const nfoWrite = vi.mocked(ipc.file.nfoWrite);
const getStatus = vi.mocked(ipc.scraper.getStatus);
const retry = vi.mocked(ipc.scraper.retry);
const start = vi.mocked(ipc.scraper.start);

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
    start.mockReset();
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

describe("startSelectedScrape", () => {
  beforeEach(() => {
    getStatus.mockReset();
    start.mockReset();
    useScrapeStore.getState().reset();
    useScrapeStore.setState({ retiredTaskIds: [] });
  });

  it("returns the launch snapshot without fetching task status again", async () => {
    const snapshot = buildScrapeSnapshot({
      task: { ...buildScrapeSnapshot().task, id: "fast-run" },
    });
    start.mockResolvedValue({ taskId: "fast-run", totalFiles: 1, message: "已启动选中文件刮削", snapshot });

    await expect(
      startSelectedScrape([{ rootId: "root-1", relativePath: "ABC-001.mp4" }], "output-root"),
    ).resolves.toEqual({
      data: { taskId: "fast-run", totalFiles: 1, message: "已启动选中文件刮削", snapshot },
    });

    expect(getStatus).not.toHaveBeenCalled();
  });
});

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
      message: "重试任务已启动，共 2 个文件",
      snapshot: buildScrapeSnapshot(),
    });

    await expect(retryScrapeSelection()).resolves.toEqual({
      data: {
        taskId: "task-1",
        totalFiles: 2,
        message: "重试任务已启动，共 2 个文件",
        snapshot: buildScrapeSnapshot(),
      },
    });

    expect(retry).toHaveBeenCalledWith("original");
  });

  it("requires a terminal run", async () => {
    useScrapeStore.getState().setSnapshot(
      buildScrapeSnapshot({
        task: { ...buildScrapeSnapshot().task, id: "running", status: "running", completedAt: null },
      }),
    );
    await expect(retryScrapeSelection()).rejects.toThrow("当前刮削任务仍在进行");

    expect(retry).not.toHaveBeenCalled();
  });

  it("requires a run in the scrape store", async () => {
    await expect(retryScrapeSelection()).rejects.toThrow("没有可重试的刮削任务");
    expect(retry).not.toHaveBeenCalled();
  });
});
