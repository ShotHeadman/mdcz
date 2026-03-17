import { Website } from "@shared/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildNfoReadCandidates, readNfo, resolveNfoWritePath, updateNfo } from "@/api/manual";
import { ipc } from "@/client/ipc";

vi.mock("@/client/ipc", () => ({
  ipc: {
    file: {
      nfoRead: vi.fn(),
      nfoWrite: vi.fn(),
    },
  },
}));

const nfoRead = vi.mocked(ipc.file.nfoRead);
const nfoWrite = vi.mocked(ipc.file.nfoWrite);

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
    sample_images: [],
    website: Website.DMM,
  };

  beforeEach(() => {
    nfoRead.mockReset();
    nfoWrite.mockReset();
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
        sample_images: [],
        website: Website.DMM,
      }),
      "/media/ABC-123.mp4",
    );

    expect(nfoWrite).toHaveBeenCalledWith("/media/ABC-123.nfo", expect.any(Object));
  });
});
