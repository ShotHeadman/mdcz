import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, relative } from "node:path";
import { defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { buildFileId } from "@mdcz/shared/mediaIdentity";
import type { CrawlerData, UncensoredChoice } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryPublicationJournal } from "../publication/memoryJournal";
import { confirmUncensoredRunItems } from "./confirmUncensored";
import { FileOrganizer, type OrganizePlan } from "./FileOrganizer";
import { NfoGenerator } from "./nfo";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "mdcz-confirm-"));
  directories.push(root);
  const source = join(root, "source");
  const output = join(root, "output");
  const metadata = join(root, "metadata");
  await Promise.all([mkdir(source), mkdir(output), mkdir(metadata)]);
  const nfoPath = join(source, "FC2-123456.nfo");
  const data: CrawlerData = {
    title: "Multipart",
    number: "FC2-123456",
    actors: [],
    genres: ["无码"],
    scene_images: [],
    website: Website.FC2,
  };
  const files = [
    "FC2-123456-CD1.mp4",
    "FC2-123456-CD2.mp4",
    "FC2-123456-CD1.zh.srt",
    "FC2-123456-CD2.ass",
    "FC2-123456-花絮.mp4",
    "poster.jpg",
    "FC2-123456.nfo",
    "movie.nfo",
  ];
  for (const file of files)
    await writeFile(join(source, file), file.endsWith(".nfo") ? "<movie><title>Original</title></movie>" : file);

  const items = [1, 2].map((part) => {
    const videoPath = join(source, `FC2-123456-CD${part}.mp4`);
    return {
      groupId: "movie-1",
      itemId: `item-${part}`,
      outcomeId: `outcome-${part}`,
      fileId: buildFileId(videoPath),
      videoPath,
      nfoPath,
      metadataVideoPath: join(metadata, `FC2-123456-CD${part}.strm`),
      crawlerData: data,
      choice: "leak" as const,
    };
  });
  for (const item of items) await writeFile(item.metadataVideoPath, item.videoPath);

  const manifest = {
    id: "task-1",
    items: items.map((item) => ({ id: item.itemId })),
  };

  const journal = createMemoryPublicationJournal();
  const mediaRoot = {
    id: "root",
    hostPath: root,
    realPath: null,
    displayName: "Root",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const generator = new NfoGenerator();
  const organizer = new FileOrganizer();

  const fileOrganizer = {
    plan: vi.fn(
      (info): OrganizePlan => ({
        outputDir: output,
        metadataDir: metadata,
        mode: "move",
        targetVideoPath: join(output, `${info.fileName}-leak.mp4`),
        nfoPath: join(metadata, "FC2-123456-leak.nfo"),
        strmPath: join(metadata, `${info.fileName}-leak.strm`),
        renameSubtitles: true,
      }),
    ),
    resolveOutputPlan: organizer.resolveOutputPlan.bind(organizer),
  };

  const nfoGenerator = {
    writeNfo: vi.fn(generator.writeNfo.bind(generator)),
  };

  const reviseSuccess = vi.fn();

  const repositories = {
    journal,
    library: {
      resolveUncensoredFiles: vi.fn(async (selections: { outcomeId: string; choice: UncensoredChoice }[]) => {
        return selections.map((selection) => {
          const item = items.find((i) => i.outcomeId === selection.outcomeId) ?? items[0];
          return {
            file: {
              id: item.fileId,
              rootId: "root",
              rootRelativePath: relative(root, item.videoPath).replace(/\\/g, "/"),
              partNumber: item.itemId === "item-1" ? 1 : 2,
              partSuffix: item.itemId === "item-1" ? "-CD1" : "-CD2",
            },
            choice: selection.choice,
            outcome: { id: selection.outcomeId },
            entry: {
              id: "movie-1",
              title: "Multipart",
              number: "FC2-123456",
              crawlerDataJson: JSON.stringify(data),
              assets: [
                {
                  id: "poster-asset",
                  itemId: "movie-1",
                  fileId: null,
                  kind: "poster",
                  rootId: "root",
                  rootRelativePath: relative(root, join(source, "poster.jpg")).replace(/\\/g, "/"),
                  targetPath: join(source, "poster.jpg"),
                },
              ],
            },
          };
        });
      }),
      getEntryById: vi.fn(async (_id: string) => ({
        id: "movie-1",
        files: items.map((item) => ({ id: item.fileId })),
        assets: [],
      })),
      publicationSnapshot: vi.fn(() => ({
        files: items.map((item) => ({
          rootId: "root",
          relativePath: relative(root, item.videoPath).replace(/\\/g, "/"),
          itemId: "movie-1",
          fileId: item.fileId,
        })),
        assets: [
          {
            rootId: "root",
            relativePath: relative(root, nfoPath).replace(/\\/g, "/"),
            itemId: "movie-1",
            fileId: null,
            kind: "nfo",
            published: true,
          },
          {
            rootId: "root",
            relativePath: relative(root, join(source, "poster.jpg")).replace(/\\/g, "/"),
            itemId: "movie-1",
            fileId: null,
            kind: "poster",
            published: true,
          },
          ...items.map((item) => ({
            rootId: "root",
            relativePath: relative(root, item.metadataVideoPath).replace(/\\/g, "/"),
            itemId: "movie-1",
            fileId: item.fileId,
            kind: "strm",
            published: true,
          })),
        ],
      })),
      publicationRoots: vi.fn(() => [{ id: "root", hostPath: root }]),
    },
    scrapeRuns: {
      summary: vi.fn(() => ({ id: "task-1", status: "completed" })),
      itemResults: vi.fn(() =>
        items.map((item) => ({
          id: item.outcomeId,
          itemId: item.itemId,
          outcome: "success",
          outputRootId: "root",
          outputRelativePath: relative(root, item.videoPath).replace(/\\/g, "/"),
        })),
      ),
      reviseSuccess,
    },
  };

  return {
    root,
    source,
    output,
    metadata,
    items,
    manifest,
    mediaRoot,
    repositories,
    fileOrganizer,
    nfoGenerator,
    journal,
  };
};

describe("confirmUncensoredRunItems", () => {
  it.each([
    { failure: false, distinctLocations: false },
    { failure: true, distinctLocations: false },
    { failure: false, distinctLocations: true },
    { failure: true, distinctLocations: true },
  ])("publishes shared NFO, subtitles, STRM and FC2 features as one batch ($failure, $distinctLocations)", async ({
    failure,
    distinctLocations,
  }) => {
    const fixtureData = await fixture();
    const { source, output, metadata, items, repositories, fileOrganizer, nfoGenerator, journal } = fixtureData;
    const otherMetadata = join(metadata, "second");
    if (distinctLocations) {
      await mkdir(otherMetadata);
      const originalPlan = fileOrganizer.plan;
      fileOrganizer.plan = vi.fn((...args: Parameters<typeof originalPlan>) => {
        const plan = originalPlan(...args);
        if (!args[0].fileName.includes("CD2")) return plan;
        return {
          ...plan,
          metadataDir: otherMetadata,
          nfoPath: join(otherMetadata, "FC2-123456-leak.nfo"),
          strmPath: join(otherMetadata, `${args[0].fileName}-leak.strm`),
        };
      });
    }
    if (failure) {
      repositories.scrapeRuns.reviseSuccess.mockImplementation(() => {
        throw new Error("commit failure");
      });
    }

    const result = await confirmUncensoredRunItems({
      manifest: fixtureData.manifest,
      items: items.map((item) => ({ itemId: item.itemId, choice: item.choice })),
      configuration: defaultConfiguration,
      roots: [fixtureData.mediaRoot],
      repositories,
      dependencies: {
        fileOrganizer,
        nfoGenerator,
      },
    });

    expect(nfoGenerator.writeNfo).toHaveBeenCalledTimes(1);
    expect(nfoGenerator.writeNfo).toHaveBeenCalledWith(
      join(metadata, "FC2-123456-leak.nfo"),
      expect.anything(),
      expect.objectContaining({
        localState: { uncensoredChoice: "leak" },
      }),
    );
    expect(journal.listUnfinished()).toEqual([]);
    expect(result.updatedCount).toBe(failure ? 0 : 2);
    expect(result.failures).toHaveLength(failure ? 2 : 0);

    for (const item of items) {
      if (failure) {
        expect(await readFile(item.videoPath, "utf8")).toBe(parse(item.videoPath).base);
        expect(await readFile(item.nfoPath, "utf8")).toContain("Original");
        expect(await readFile(item.metadataVideoPath, "utf8")).toBe(item.videoPath);
      } else {
        const target = join(output, `${parse(item.videoPath).name}-leak.mp4`);
        expect(await readFile(target, "utf8")).toBe(parse(item.videoPath).base);
        const itemMetadata = distinctLocations && item.videoPath.includes("CD2") ? otherMetadata : metadata;
        expect(await readFile(join(itemMetadata, `${parse(item.videoPath).name}-leak.strm`), "utf8")).toBe(target);
        expect(result.items.find((update) => update.fileId === item.fileId)?.targetNfoPath).toBe(
          join(metadata, "FC2-123456-leak.nfo"),
        );
        await expect(readFile(item.videoPath)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readFile(item.metadataVideoPath, "utf8")).toBe(item.videoPath);
      }
    }

    for (const [original, renamed] of [
      ["FC2-123456-CD1.zh.srt", "FC2-123456-CD1-leak.zh.srt"],
      ["FC2-123456-CD2.ass", "FC2-123456-CD2-leak.ass"],
      ["FC2-123456-花絮.mp4", "FC2-123456-leak-花絮.mp4"],
    ]) {
      expect(await readFile(join(failure ? source : output, failure ? original : renamed), "utf8")).toBe(original);
    }

    if (!failure) {
      expect(await readFile(join(metadata, "poster.jpg"), "utf8")).toBe("poster.jpg");
      if (distinctLocations) {
        expect(await readFile(join(otherMetadata, "poster.jpg"), "utf8")).toBe("poster.jpg");
        expect(await readFile(join(otherMetadata, "FC2-123456-leak.nfo"), "utf8")).toBe(
          await readFile(join(metadata, "FC2-123456-leak.nfo"), "utf8"),
        );
      }
      expect(await readFile(join(source, "movie.nfo"), "utf8")).toContain("Original");
    }
  });

  it.each([
    "missing-video",
    "disabled-nfo",
  ])("requires media but does not require NFO ownership: %s", async (scenario) => {
    const fixtureData = await fixture();
    const { items, repositories, fileOrganizer, nfoGenerator } = fixtureData;
    const config = structuredClone(defaultConfiguration);
    if (scenario === "missing-video") {
      await rm(items[0].videoPath);
    } else {
      config.download.generateNfo = false;
      repositories.library.publicationSnapshot = vi.fn(() => ({
        files: items.map((item) => ({
          rootId: "root",
          relativePath: relative(fixtureData.root, item.videoPath).replace(/\\/g, "/"),
          itemId: "movie-1",
          fileId: item.fileId,
        })),
        assets: items.map((item) => ({
          rootId: "root",
          relativePath: relative(fixtureData.root, item.metadataVideoPath).replace(/\\/g, "/"),
          itemId: "movie-1",
          fileId: item.fileId,
          kind: "strm",
          published: true,
        })),
      }));
    }

    const result = await confirmUncensoredRunItems({
      manifest: fixtureData.manifest,
      items: [
        { itemId: items[0].itemId, choice: items[0].choice },
        { itemId: items[1].itemId, choice: items[1].choice },
      ],
      configuration: config,
      roots: [fixtureData.mediaRoot],
      repositories,
      dependencies: {
        fileOrganizer,
        nfoGenerator,
      },
    });

    if (scenario === "missing-video") {
      expect(result.updatedCount).toBe(0);
      expect(result.failures[0].message).toContain("output files not found");
    } else {
      expect(result.failures).toEqual([]);
      expect(result.updatedCount).toBe(2);
      expect(result.items[0].targetNfoPath).toBeDefined();
    }
  });

  it("rejects multipart main-video conflicts without changing paths or shared resources", async () => {
    const fixtureData = await fixture();
    const { source, output, metadata, items, repositories, fileOrganizer, nfoGenerator } = fixtureData;
    for (const item of items) {
      const base = `${parse(item.videoPath).name}-leak`;
      await writeFile(join(output, `${base}.mp4`), `old-${base}`);
      await writeFile(join(output, `${base}${item.videoPath.includes("CD1") ? ".zh.srt" : ".ass"}`), "old-subtitle");
    }

    const result = await confirmUncensoredRunItems({
      manifest: fixtureData.manifest,
      items: items.map((item) => ({ itemId: item.itemId, choice: item.choice })),
      configuration: defaultConfiguration,
      roots: [fixtureData.mediaRoot],
      repositories,
      dependencies: {
        fileOrganizer,
        nfoGenerator,
      },
    });

    expect(result.updatedCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.failures).toHaveLength(2);
    for (const item of items) {
      const base = `${parse(item.videoPath).name}-leak`;
      expect(await readFile(item.videoPath, "utf8")).toBe(parse(item.videoPath).base);
      expect(await readFile(join(output, `${base}.mp4`), "utf8")).toBe(`old-${base}`);
      expect(await readFile(item.metadataVideoPath, "utf8")).toBe(item.videoPath);
      expect(await readFile(item.nfoPath, "utf8")).toContain("Original");
      await expect(readFile(join(output, `${base} (1).mp4`))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await readFile(join(source, "FC2-123456-花絮.mp4"), "utf8")).toBe("FC2-123456-花絮.mp4");
    expect(await readFile(join(source, "poster.jpg"), "utf8")).toBe("poster.jpg");
    await expect(readFile(join(metadata, "FC2-123456-leak.nfo"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects conflicting choices for a registered movie before preparing output", async () => {
    const fixtureData = await fixture();
    const { items, repositories, fileOrganizer, nfoGenerator } = fixtureData;
    await expect(
      confirmUncensoredRunItems({
        manifest: fixtureData.manifest,
        items: [
          { itemId: items[0].itemId, choice: "leak" },
          { itemId: items[1].itemId, choice: "umr" },
        ],
        configuration: defaultConfiguration,
        roots: [fixtureData.mediaRoot],
        repositories,
        dependencies: {
          fileOrganizer,
          nfoGenerator,
        },
      }),
    ).rejects.toThrow("同一影片不能选择不同的无码类型");
    expect(nfoGenerator.writeNfo).not.toHaveBeenCalled();
  });
});
