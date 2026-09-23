import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaRoot } from "@mdcz/media-store";
import { defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { NfoGenerator } from "./nfo";
import { registeredPosterCropContext, writeNfoPublication } from "./registeredArtifacts";

describe("registeredPosterCropContext", () => {
  it.each(
    [[], ["movie-a"], ["movie-a", "movie-b"]].map((owners) => ({ owners })),
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
      await expect(result).resolves.toMatchObject({ assets: {}, movieId: "movie-a" });
      expect(library.getEntryById).toHaveBeenCalledWith("movie-a");
    } else {
      await expect(result).rejects.toThrow(owners.length ? "多个影片" : "尚未入库");
      expect(library.getEntryById).not.toHaveBeenCalled();
    }
  });

  it("commits edited NFO metadata with its registered asset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mdcz-registered-nfo-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const root = createMediaRoot({ id: "root", displayName: "Root", hostPath: directory });
    const nfoPath = join(directory, "movie.nfo");
    await writeFile(nfoPath, "<movie><title>Old</title><num>OLD-1</num></movie>");
    const writeEntry = vi.fn(() => "movie-a");
    const library = {
      publicationSnapshot: vi.fn(() => ({
        files: [{ itemId: "movie-a", fileId: "file-a", rootId: root.id, relativePath: "video.mp4" }],
        assets: [
          {
            itemId: "movie-a",
            fileId: null,
            rootId: root.id,
            relativePath: "movie.nfo",
            kind: "nfo",
            published: true,
          },
        ],
      })),
      publicationRoots: vi.fn(() => [{ id: root.id, hostPath: root.hostPath }]),
      getEntryById: vi.fn(async () => ({ assets: [] })),
      writeEntry,
    };
    const data = {
      title: "Edited",
      number: "NEW-1",
      actors: ["Actor"],
      genres: ["Tag"],
      scene_images: [],
      website: Website.JAVBUS,
    };
    await writeNfoPublication({
      nfoPath,
      data,
      configuration: defaultConfiguration,
      nfoGenerator: new NfoGenerator(),
      publication: { roots: [root], outputs: library, library },
    });
    expect(writeEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "movie-a",
        mediaIdentity: "NEW-1",
        title: "Edited",
        number: "NEW-1",
        actors: ["Actor"],
        crawlerDataJson: JSON.stringify(data),
      }),
      [],
    );
  });
});
