import { describe, expect, it, vi } from "vitest";
import { registeredPosterCropContext } from "./registeredArtifacts";

describe("registeredPosterCropContext", () => {
  it.each(
    [[], ["movie-a"], ["movie-a", "movie-a"], ["movie-a", "movie-b"]].map((owners) => ({ owners })),
  )("requires one distinct movie owner ($owners)", async ({ owners }) => {
    const library = {
      publicationSnapshot: vi.fn(() => ({
        files: owners.map((itemId) => ({ itemId, rootId: "root", relativePath: "video.mp4" })),
        assets: [],
      })),
      getEntryById: vi.fn(async () => ({ assets: [] })),
      writeEntry: vi.fn(() => "movie-a"),
    };
    const result = registeredPosterCropContext("/media/video.mp4", library, async () => ({
      id: "root",
      hostPath: "/media",
    }));
    if (new Set(owners).size === 1) {
      await expect(result).resolves.toMatchObject({ assets: {} });
      expect(library.getEntryById).toHaveBeenCalledWith("movie-a");
    } else {
      await expect(result).rejects.toThrow(owners.length ? "多个影片" : "尚未入库");
      expect(library.getEntryById).not.toHaveBeenCalled();
    }
  });
});
