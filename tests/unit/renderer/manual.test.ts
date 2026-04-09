import { Website } from "@shared/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildNfoReadCandidates, readNfo, resolveNfoWritePath, retryScrapeSelection, updateNfo } from "@/api/manual";
import { ipc } from "@/client/ipc";

vi.mock("@/client/ipc", () => ({
  ipc: {
    file: {
      nfoRead: vi.fn(),
      nfoWrite: vi.fn(),
    },
    scraper: {
      requeue: vi.fn(),
      retryFailed: vi.fn(),
    },
  },
}));

const nfoRead = vi.mocked(ipc.file.nfoRead);
const nfoWrite = vi.mocked(ipc.file.nfoWrite);
const requeue = vi.mocked(ipc.scraper.requeue);
const retryFailed = vi.mocked(ipc.scraper.retryFailed);

describe("buildNfoReadCandidates", () => {
  it("prefers movie.nfo before basename nfo for video paths to mirror Jellyfin", () => {
    expect(buildNfoReadCandidates("/media/ABC-123.mp4")).toEqual(["/media/movie.nfo", "/media/ABC-123.nfo"]);
  });

  it("keeps the current separator style for windows paths", () => {
    expect(buildNfoReadCandidates("C:\\media\\ABC-123.mp4")).toEqual([
      "C:\\media\\movie.nfo",
      "C:\\media\\ABC-123.nfo",
    ]);
  });

  it("does not add duplicate fallbacks for movie.nfo itself", () => {
    expect(buildNfoReadCandidates("/media/movie.nfo")).toEqual(["/media/movie.nfo"]);
  });
});

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
    requeue.mockReset();
    retryFailed.mockReset();
  });

  it("falls back to basename nfo only when movie.nfo is missing", async () => {
    nfoRead
      .mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "ENOENT" }))
      .mockResolvedValueOnce({ data: crawlerData });

    await expect(readNfo("/media/ABC-123.mp4")).resolves.toEqual({
      data: {
        path: "/media/ABC-123.nfo",
        content: JSON.stringify(crawlerData, null, 2),
      },
    });

    expect(nfoRead).toHaveBeenNthCalledWith(1, "/media/movie.nfo");
    expect(nfoRead).toHaveBeenNthCalledWith(2, "/media/ABC-123.nfo");
  });

  it("does not hide real nfo parsing errors behind the movie.nfo fallback", async () => {
    nfoRead.mockRejectedValueOnce(Object.assign(new Error("invalid nfo"), { code: "PARSE_ERROR" }));

    await expect(readNfo("/media/ABC-123.mp4")).rejects.toMatchObject({
      message: "invalid nfo",
      code: "PARSE_ERROR",
    });
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
    nfoWrite.mockResolvedValue({ success: true });

    await updateNfo(
      "/media/movie.nfo",
      JSON.stringify({
        title: "Movie Title",
        number: "ABC-123",
        actors: [],
        genres: [],
        scene_images: [],
        website: Website.DMM,
      }),
      "/media/ABC-123.mp4",
    );

    expect(nfoWrite).toHaveBeenCalledWith("/media/ABC-123.nfo", expect.any(Object));
  });
});

describe("retryScrapeSelection", () => {
  beforeEach(() => {
    requeue.mockReset();
    retryFailed.mockReset();
  });

  it("starts a new retry task when the scraper is idle", async () => {
    retryFailed.mockResolvedValue({
      taskId: "task-1",
      totalFiles: 2,
      message: "重试任务已启动，共 2 个文件",
    });

    await expect(
      retryScrapeSelection(["/media/ABC-123.mp4", "/media/ABC-123-CD2.mp4"], { scrapeStatus: "idle" }),
    ).resolves.toEqual({
      data: {
        message: "重试任务已启动，共 2 个文件",
        queued: 2,
        running: true,
        strategy: "new-task",
      },
    });

    expect(retryFailed).toHaveBeenCalledWith(["/media/ABC-123.mp4", "/media/ABC-123-CD2.mp4"]);
    expect(requeue).not.toHaveBeenCalled();
  });

  it("requeues failed files into the current task when a scrape is already running", async () => {
    requeue.mockResolvedValue({ requeuedCount: 1 });

    await expect(
      retryScrapeSelection("/media/ABC-123.mp4", {
        scrapeStatus: "running",
        canRequeueCurrentRun: true,
      }),
    ).resolves.toEqual({
      data: {
        message: "已加入当前任务队列，共 1 个文件",
        queued: 1,
        running: true,
        strategy: "requeue",
      },
    });

    expect(requeue).toHaveBeenCalledWith(["/media/ABC-123.mp4"]);
    expect(retryFailed).not.toHaveBeenCalled();
  });

  it("rejects retrying successful items while the current scrape is still running", async () => {
    await expect(
      retryScrapeSelection("/media/ABC-123.mp4", {
        scrapeStatus: "running",
        canRequeueCurrentRun: false,
      }),
    ).rejects.toThrow("当前刮削任务仍在进行，已成功项目请等待任务结束后再重新刮削");

    expect(requeue).not.toHaveBeenCalled();
    expect(retryFailed).not.toHaveBeenCalled();
  });
});
