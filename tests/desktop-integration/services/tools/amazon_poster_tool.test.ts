import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalScanService, parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import type { RuntimeDownloadNetworkClient } from "@mdcz/runtime/network";
import {
  DownloadManager,
  listPosterBadgeDefinitions,
  MemoryImageHostCooldownStore,
  NfoGenerator,
  PosterWatermarkService,
} from "@mdcz/runtime/scrape";
import { applyAmazonPosters, lookupAmazonPoster, scanAmazonPosters } from "@mdcz/runtime/tools";
import { configurationSchema } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import {
  type NormalizedCropRegion,
  normalizedCropToPixels,
  resolvePosterEditorCropRegion,
} from "@mdcz/shared/posterCrop";
import type { CrawlerData, PosterRecord } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const sharp = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("sharp");

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-amazon-poster-tool-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const solid = async (width: number, height: number) =>
  await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .jpeg()
    .toBuffer();

const writeMovie = async (
  directory: string,
  videos: string[],
  data: Partial<CrawlerData> & Pick<CrawlerData, "number" | "title">,
  posterRecord?: PosterRecord,
) => {
  await mkdir(directory, { recursive: true });
  for (const video of videos) await writeFile(join(directory, video), "video");
  await writeFile(
    join(directory, `${data.number}.nfo`),
    new NfoGenerator().buildXml(
      { actors: [], genres: [], scene_images: [], website: Website.JAVDB, ...data },
      { localState: { posterRecord } },
    ),
  );
};

const config = configurationSchema.parse({ download: { tagBadges: true, tagBadgeTypes: ["censored"] } });

describe("Amazon poster tool", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(async (dirPath) => await rm(dirPath, { recursive: true, force: true })));
  });

  it("scans each movie once by its video, with its original title, poster size and the cut it was made with", async () => {
    const root = await createTempDir();
    const cut = { source: "https://m.media-amazon.com/images/I/a.jpg", crop: resolvePosterEditorCropRegion(600, 800) };
    await writeMovie(
      join(root, "AAA-001"),
      ["AAA-001.mp4"],
      { number: "AAA-001", title: "天然成分由来 瀧本雫葉汁 120% 83", title_zh: "中文标题" },
      { stamp: "", sha256: "0".repeat(64), cut },
    );
    await writeFile(join(root, "AAA-001", "poster.jpg"), await solid(400, 600));
    await writeMovie(join(root, "nested", "BBB-002"), ["BBB-002-cd1.mp4", "BBB-002-cd2.mp4"], {
      number: "BBB-002",
      title: "Title B",
    });
    await writeMovie(join(root, "no-video"), [], { number: "CCC-003", title: "No video" });
    await mkdir(join(root, "empty"));

    const scan = async (directory: string) => await scanAmazonPosters(directory, config, new LocalScanService());

    expect(await scan(root)).toEqual([
      {
        filePath: join(root, "AAA-001", "AAA-001.mp4"),
        nfoPath: join(root, "AAA-001", "AAA-001.nfo"),
        title: "天然成分由来 瀧本雫葉汁 120% 83",
        number: "AAA-001",
        currentPosterPath: join(root, "AAA-001", "poster.jpg"),
        currentPosterWidth: 400,
        currentPosterHeight: 600,
        posterCut: cut,
      },
      {
        filePath: expect.stringMatching(/BBB-002-cd[12]\.mp4$/u),
        nfoPath: join(root, "nested", "BBB-002", "BBB-002.nfo"),
        title: "Title B",
        number: "BBB-002",
        currentPosterPath: null,
        currentPosterWidth: 0,
        currentPosterHeight: 0,
      },
    ]);
    await expect(scan(join(root, "empty"))).resolves.toEqual([]);
  });

  it("returns lookup misses and reports Amazon hits for the title it is given", async () => {
    const enhanceAmazonPoster = vi
      .fn()
      .mockResolvedValueOnce({ reason: "no_results" as const })
      .mockResolvedValueOnce({
        reason: "found" as const,
        poster_url: "https://m.media-amazon.com/images/I/81test.jpg",
      });
    const lookup = async (title: string) =>
      await lookupAmazonPoster({} as never, "/library/ABC-123.nfo", title, { enhanceAmazonPoster });

    await expect(lookup("Lookup Title")).resolves.toMatchObject({ amazonPosterUrl: null, reason: "no_results" });
    await expect(lookup("Custom Amazon Title")).resolves.toMatchObject({
      amazonPosterUrl: "https://m.media-amazon.com/images/I/81test.jpg",
      reason: "found",
    });
    expect(enhanceAmazonPoster).toHaveBeenLastCalledWith("Custom Amazon Title");
  });

  it("cuts the Amazon image by the chosen area, draws badges and records how, or leaves a failed movie as it was", async () => {
    const root = await createTempDir();
    const directory = join(root, "ABC-001");
    const videoPath = join(directory, "ABC-001.mp4");
    const nfoPath = join(directory, "ABC-001.nfo");
    const posterPath = join(directory, "poster.jpg");
    const sitePoster = "https://site.example/ABC-001-poster.jpg";
    await writeMovie(directory, ["ABC-001.mp4"], { number: "ABC-001", title: "Title", poster_source_url: sitePoster });
    await writeFile(posterPath, await solid(200, 300));
    const amazonImage = await sharp(randomBytes(600 * 800 * 3), { raw: { width: 600, height: 800, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const images: Record<string, Buffer> = { "https://m.media-amazon.com/images/I/found.jpg": amazonImage };
    const networkClient = {
      getText: vi.fn(),
      probe: async (url: string) => ({
        ok: Boolean(images[url]),
        status: images[url] ? 200 : 404,
        contentLength: images[url]?.length ?? null,
        resolvedUrl: url,
        ...(images[url] && { width: 600, height: 800 }),
      }),
      download: async (url: string, outputPath: string) => {
        if (!images[url]) throw new Error(`HTTP 404: ${url}`);
        await writeFile(outputPath, images[url]);
        return outputPath;
      },
    } as unknown as RuntimeDownloadNetworkClient;
    const localScanService = new LocalScanService();
    const apply = async (amazonPosterUrl: string, crop: NormalizedCropRegion) =>
      await applyAmazonPosters([{ filePath: videoPath, amazonPosterUrl, crop }], config, {
        downloadManager: new DownloadManager(networkClient, {
          imageHostCooldownStore: new MemoryImageHostCooldownStore(),
        }),
        localScanService,
        nfoGenerator: new NfoGenerator(),
        dataDir: root,
        libraries: [],
        publication: { roots: [{ id: "tmp", hostPath: root }] },
      });
    const found = "https://m.media-amazon.com/images/I/found.jpg";
    const rows: Array<{ name: string; url: string; crop: () => Promise<NormalizedCropRegion> }> = [
      { name: "the starting area", url: found, crop: async () => resolvePosterEditorCropRegion(600, 800) },
      { name: "a confirmed area", url: found, crop: async () => ({ x: 0, y: 0.25, width: 0.5, height: 0.5625 }) },
      {
        name: "the stored area",
        url: found,
        crop: async () => {
          const [item] = await scanAmazonPosters(root, config, localScanService);
          if (!item.posterCut) throw new Error("The last apply recorded no cut");
          expect(item.posterCut.source).toBe(found);
          return item.posterCut.crop;
        },
      },
      {
        name: "a failed download",
        url: "https://m.media-amazon.com/images/I/gone.jpg",
        crop: async () => ({ x: 0, y: 0, width: 1, height: 1 }),
      },
    ];

    for (const row of rows) {
      const crop = await row.crop();
      const before = { poster: await readFile(posterPath), nfo: await readFile(nfoPath, "utf8") };
      const [result] = await apply(row.url, crop);
      const snapshot = parseNfoSnapshot(await readFile(nfoPath, "utf8"));
      expect(snapshot.crawlerData.poster_source_url, row.name).toBe(sitePoster);
      if (row.url !== found) {
        expect(result, row.name).toMatchObject({ filePath: videoPath, success: false });
        expect(await readFile(posterPath), row.name).toEqual(before.poster);
        expect(await readFile(nfoPath, "utf8"), row.name).toBe(before.nfo);
        continue;
      }
      expect(result, row.name).toEqual({ filePath: videoPath, success: true });
      const expectedPath = join(root, "expected.jpg");
      await sharp(amazonImage)
        .extract(normalizedCropToPixels(crop, 600, 800))
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toFile(expectedPath);
      await new PosterWatermarkService({ dataDir: root }).applyTagBadges(
        expectedPath,
        listPosterBadgeDefinitions(["censored"]),
        { position: "topLeft", sizePercent: 100, insetPercent: 3, opacity: 100 },
      );
      const poster = await readFile(posterPath);
      expect(await sharp(poster).raw().toBuffer(), row.name).toEqual(await sharp(expectedPath).raw().toBuffer());
      expect(snapshot.localState?.posterRecord, row.name).toEqual({
        stamp: expect.stringMatching(/^censored\|/u),
        sha256: createHash("sha256").update(poster).digest("hex"),
        cut: { source: found, crop },
      });
    }
  });
});
