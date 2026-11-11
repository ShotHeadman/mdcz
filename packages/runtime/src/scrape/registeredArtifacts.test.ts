import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaRoot } from "@mdcz/media-store";
import { defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { parseNfoSnapshot } from "../maintenance/nfoSnapshot";
import { acquireOutputDirectories } from "../publication/outputMutex";
import { NfoGenerator } from "./nfo";
import { registeredPosterCropContext, writeNfoPublication } from "./registeredArtifacts";

describe("registered artifacts", () => {
  it.each(
    [[], ["movie-a"], ["movie-a", "movie-b"]].map((owners) => ({ owners })),
  )("finds the one distinct movie owner, if any ($owners)", async ({ owners }) => {
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
      if (owners.length) await expect(result).rejects.toThrow("referenced by multiple library movies");
      else await expect(result).resolves.toBeNull();
      expect(library.getEntryById).not.toHaveBeenCalled();
    }
  });

  it("saves each locked NFO and the richer library record together, or restores every copy", async () => {
    for (const failure of [undefined, "invalid NFO", "library commit", "excluded field"] as const) {
      const directory = await mkdtemp(join(tmpdir(), "mdcz-registered-nfo-"));
      onTestFinished(() => rm(directory, { recursive: true, force: true }));
      const root = createMediaRoot({ id: "root", displayName: "Root", hostPath: directory });
      const targets = [join(directory, "movie.nfo"), join(directory, "video.nfo")];
      const generator = new NfoGenerator();
      const original: CrawlerData = {
        title: "Original",
        number: "OLD-1",
        actors: ["Actor A"],
        genres: ["Original genre"],
        scene_images: [],
        actor_profiles: [
          { name: "Actor A", aliases: ["Alias"], height_cm: 170, photo_url: "https://example.com/actor.jpg" },
        ],
        thumb_url: "https://example.com/remote-thumb.jpg",
        website: Website.JAVBUS,
      };
      const originalXml = generator.buildXml(original).replace("</movie>", "<providerid>007</providerid></movie>");
      const secondXml =
        failure === "invalid NFO"
          ? "<movie><title>Broken</title><num>BROKEN-1</num></wrong>"
          : originalXml.replace("Original genre", "Second genre");
      await writeFile(targets[0], originalXml);
      await writeFile(targets[1], secondXml);
      const assets = ["movie.nfo", "video.nfo"].map((relativePath) => ({
        itemId: "movie-a",
        fileId: null,
        rootId: root.id,
        relativePath,
        uri: relativePath,
        kind: "nfo" as const,
        published: true,
      }));
      let storedData = original;
      const writeEntry = vi.fn(() => {
        if (failure === "library commit") throw new Error("library commit failed");
        return "movie-a";
      });
      const library = {
        publicationSnapshot: vi.fn(() => ({
          files: [{ itemId: "movie-a", fileId: "file-a", rootId: root.id, relativePath: "video.mp4" }],
          assets,
        })),
        publicationRoots: vi.fn(() => [{ id: root.id, hostPath: root.hostPath }]),
        getEntryById: vi.fn(async () => ({ assets, crawlerDataJson: JSON.stringify(storedData) })),
        writeEntry,
      };
      const release = await acquireOutputDirectories(targets);
      onTestFinished(release);
      const save = writeNfoPublication({
        nfoPath: targets[0],
        data: {
          ...parseNfoSnapshot(originalXml).crawlerData,
          title: "Edited",
          number: "NEW-1",
          actor_profiles: [{ name: "Actor A", photo_url: "https://example.com/new-actor.jpg" }],
        },
        changedFields: failure === "excluded field" ? ["title", "genres"] : ["title", "number", "actor_profiles"],
        configuration: {
          ...defaultConfiguration,
          download: { ...defaultConfiguration.download, nfoIgnoreFields: ["genres"] },
        },
        nfoNaming: "both",
        nfoGenerator: generator,
        publication: { roots: [root], outputs: library, library },
      });
      const saved = failure
        ? expect(save).rejects.toThrow(
            failure === "excluded field"
              ? "excluded by download.nfoIgnoreFields"
              : failure === "invalid NFO"
                ? "Invalid NFO XML"
                : "library commit failed",
          )
        : expect(save).resolves.toMatchObject({ path: targets[0], changed: true });
      if (failure === "excluded field") {
        await saved;
        expect(await Promise.all(targets.map((target) => readFile(target, "utf8")))).toEqual([originalXml, secondXml]);
        expect(writeEntry).not.toHaveBeenCalled();
        release();
        continue;
      }
      await vi.waitFor(() => expect(library.publicationSnapshot).toHaveBeenCalled());
      const lockedXml = originalXml.replace("Original genre", "Changed under lock");
      await writeFile(targets[0], lockedXml);
      storedData = { ...original, studio: "Changed under lock" };
      release();
      await saved;
      const written = await Promise.all(targets.map((target) => readFile(target, "utf8")));
      if (failure) {
        expect(written).toEqual([lockedXml, secondXml]);
        expect(writeEntry).toHaveBeenCalledTimes(failure === "library commit" ? 1 : 0);
        continue;
      }
      for (const [index, xml] of written.entries()) {
        const snapshot = parseNfoSnapshot(xml);
        expect(snapshot.crawlerData).toMatchObject({
          title: "Edited",
          number: "NEW-1",
          genres: [index === 0 ? "Changed under lock" : "Second genre"],
          actor_profiles: [{ name: "Actor A", photo_url: "https://example.com/new-actor.jpg" }],
        });
        expect(snapshot.localState?.edits?.title).toBeDefined();
        expect(xml).toContain("<providerid>007</providerid>");
      }
      expect(writeEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "movie-a",
          mediaIdentity: "NEW-1",
          title: "Edited",
          number: "NEW-1",
          actors: ["Actor A"],
          crawlerDataJson: JSON.stringify({
            ...storedData,
            title: "Edited",
            number: "NEW-1",
            actor_profiles: [{ ...original.actor_profiles?.[0], photo_url: "https://example.com/new-actor.jpg" }],
          }),
        }),
        [],
      );
    }
  });
});
