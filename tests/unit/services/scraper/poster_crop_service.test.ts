import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaRoot } from "@mdcz/media-store";
import { LocalScanService, parseNfoSnapshot } from "@mdcz/runtime/maintenance";
import type { RuntimeDownloadNetworkClient } from "@mdcz/runtime/network";
import {
  DownloadManager,
  listPosterBadgeDefinitions,
  MemoryImageHostCooldownStore,
  NfoGenerator,
  PosterCropService,
  PosterWatermarkService,
} from "@mdcz/runtime/scrape";
import type { AssetNamingMode } from "@mdcz/shared/assetNaming";
import { configurationSchema } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { normalizedCropToPixels, resolvePosterEditorCropRegion } from "@mdcz/shared/posterCrop";
import type { CrawlerData, PosterCut } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const sharp = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("sharp");
const tempDirs: string[] = [];
const amazonUrl = "https://m.media-amazon.com/images/I/a.jpg";
const coverUrl = "https://site.example/cover.jpg";
const remoteSizes: Record<string, { width: number; height: number }> = {
  [amazonUrl]: { width: 600, height: 800 },
  [coverUrl]: { width: 900, height: 500 },
};
const networkClient = {
  getText: vi.fn(),
  probe: async (url: string) => ({
    ok: Boolean(remoteSizes[url]),
    status: remoteSizes[url] ? 206 : 404,
    contentLength: null,
    resolvedUrl: url,
    ...remoteSizes[url],
  }),
  download: async (url: string) => {
    throw new Error(`No download expected: ${url}`);
  },
} as unknown as RuntimeDownloadNetworkClient;
const service = new PosterCropService(
  new DownloadManager(networkClient, { imageHostCooldownStore: new MemoryImageHostCooldownStore() }),
);
const config = configurationSchema.parse({ download: { tagBadges: true, tagBadgeTypes: ["censored"] } });
const image = async (width: number, height: number) =>
  await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 70, b: 48 } } })
    .composite([
      {
        input: await sharp({
          create: { width: Math.round(width / 2), height, channels: 3, background: { r: 20, g: 90, b: 160 } },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .jpeg()
    .toBuffer();

const movie = async (input: { files?: Record<string, Buffer>; nfo?: Partial<CrawlerData>; cut?: PosterCut }) => {
  const root = await mkdtemp(join(tmpdir(), "mdcz-poster-crop-"));
  tempDirs.push(root);
  const videoPath = join(root, "ABC-123.mp4");
  await writeFile(videoPath, "video");
  for (const [name, bytes] of Object.entries(input.files ?? {})) await writeFile(join(root, name), bytes);
  if (input.nfo)
    await writeFile(
      join(root, "ABC-123.nfo"),
      new NfoGenerator().buildXml(
        {
          title: "Title",
          number: "ABC-123",
          actors: [],
          genres: [],
          scene_images: [],
          website: Website.JAVDB,
          ...input.nfo,
        },
        { localState: { posterRecord: input.cut && { stamp: "", sha256: "0".repeat(64), cut: input.cut } } },
      ),
    );
  const scan = async () =>
    await new LocalScanService().scanVideo(
      createMediaRoot({ id: "root", displayName: root, hostPath: root }),
      videoPath,
      "extrafanart",
    );
  return { root, videoPath, scan };
};

describe("PosterCropService", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(async (dirPath) => await rm(dirPath, { recursive: true, force: true })));
  });

  it("opens the poster's own source, then the cover, local before remote, then the poster file itself", async () => {
    const amazonCrop = resolvePosterEditorCropRegion(600, 800);
    const coverCrop = { x: 0, y: 0, width: (500 * 2) / 3 / 900, height: 1 };
    const rows: Array<{
      name: string;
      files?: Record<string, Buffer>;
      nfo?: Partial<CrawlerData>;
      cut?: PosterCut;
      naming?: AssetNamingMode;
      expected: { source: string; initialCrop: unknown; target: string } | null;
    }> = [
      {
        name: "the recorded image",
        files: { "thumb.jpg": await image(900, 500) },
        nfo: {},
        cut: { source: amazonUrl, crop: amazonCrop },
        expected: { source: amazonUrl, initialCrop: amazonCrop, target: "poster.jpg" },
      },
      {
        name: "the cover when the recorded image is gone",
        files: { "thumb.jpg": await image(900, 500) },
        nfo: {},
        cut: { source: "https://m.media-amazon.com/images/I/gone.jpg", crop: amazonCrop },
        expected: { source: "thumb.jpg", initialCrop: resolvePosterEditorCropRegion(900, 500), target: "poster.jpg" },
      },
      {
        name: "the cover the poster was cut from",
        files: { "ABC-123-thumb.jpg": await image(900, 500) },
        nfo: {},
        cut: { source: "cover", crop: coverCrop },
        naming: "followVideo",
        expected: { source: "ABC-123-thumb.jpg", initialCrop: coverCrop, target: "ABC-123-poster.jpg" },
      },
      {
        name: "the remote cover",
        files: { "poster.png": await image(400, 600) },
        nfo: { thumb_url: coverUrl, thumb_source_url: coverUrl, poster_url: "poster.png" },
        cut: { source: "cover", crop: coverCrop },
        expected: { source: coverUrl, initialCrop: coverCrop, target: "poster.png" },
      },
      {
        name: "the poster file without any cover",
        files: { "poster.jpg": await image(400, 600) },
        expected: { source: "poster.jpg", initialCrop: resolvePosterEditorCropRegion(400, 600), target: "poster.jpg" },
      },
      { name: "nothing to cut from", nfo: {}, expected: null },
    ];

    for (const row of rows) {
      const { root, scan } = await movie(row);
      const session = await service.prepare(await scan(), row.naming ?? "fixed");
      expect(
        session && {
          source: "url" in session.source ? session.source.url : session.source.path.slice(root.length + 1),
          initialCrop: session.initialCrop,
          target: session.targetPath.slice(root.length + 1),
        },
        row.name,
      ).toEqual(row.expected);
    }
  });

  it("saves the cut with badges and records it in the NFO, so the dialog opens on it again", async () => {
    const cover = await image(900, 500);
    const { root, videoPath, scan } = await movie({ files: { "thumb.jpg": cover }, nfo: {} });
    const crop = { x: 0.2, y: 0, width: (500 * 2) / 3 / 900, height: 1 };

    await service.save(await scan(), "fixed", crop, {
      config,
      dataDir: root,
      nfoGenerator: new NfoGenerator(),
      publication: { roots: [] },
      logger: { warn: vi.fn() },
    });

    const expectedPath = join(root, "expected.jpg");
    await sharp(cover)
      .extract(normalizedCropToPixels(crop, 900, 500))
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
      .toFile(expectedPath);
    await new PosterWatermarkService({ dataDir: root }).applyTagBadges(
      expectedPath,
      listPosterBadgeDefinitions(["censored"]),
      { position: "topLeft", sizePercent: 100, insetPercent: 3, opacity: 100 },
    );
    const poster = await readFile(join(root, "poster.jpg"));
    expect(await sharp(poster).raw().toBuffer()).toEqual(await sharp(expectedPath).raw().toBuffer());
    expect(parseNfoSnapshot(await readFile(join(root, "ABC-123.nfo"), "utf8")).localState?.posterRecord).toEqual({
      stamp: expect.stringMatching(/^censored\|/u),
      sha256: createHash("sha256").update(poster).digest("hex"),
      cut: { source: "cover", crop },
    });
    expect(await readFile(videoPath, "utf8")).toBe("video");
    expect((await service.prepare(await scan(), "fixed"))?.initialCrop).toEqual(crop);
  });

  it("leaves the poster and NFO as they were when the area isn't 2:3 on the source", async () => {
    const sources: Array<Record<string, Buffer>> = [
      { "thumb.jpg": await image(900, 500) },
      { "poster.jpg": await image(400, 600) },
    ];
    for (const files of sources) {
      const { root, scan } = await movie({ files, nfo: {} });
      const before = await Promise.all(
        ["ABC-123.nfo", "poster.jpg"].map(async (name) => await readFile(join(root, name)).catch(() => null)),
      );

      await expect(
        service.save(
          await scan(),
          "fixed",
          { x: 0, y: 0, width: 0.5, height: 0.9 },
          {
            config,
            dataDir: root,
            nfoGenerator: new NfoGenerator(),
            publication: { roots: [] },
            logger: { warn: vi.fn() },
          },
        ),
      ).rejects.toThrow();
      await expect(
        Promise.all(
          ["ABC-123.nfo", "poster.jpg"].map(async (name) => await readFile(join(root, name)).catch(() => null)),
        ),
      ).resolves.toEqual(before);
    }
  });
});
