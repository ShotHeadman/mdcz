import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, DownloadedAssets, FileInfo } from "@mdcz/shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPosterTagBadgesIfNeeded } from "./applyPosterTagBadges";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createFileInfo = (overrides: Partial<FileInfo> = {}): FileInfo => ({
  filePath: "/tmp/ABC-123.mp4",
  fileName: "ABC-123.mp4",
  extension: ".mp4",
  number: "ABC-123",
  isSubtitled: false,
  ...overrides,
});

const createConfiguration = (download: Partial<typeof defaultConfiguration.download> = {}) =>
  configurationSchema.parse({
    download: {
      ...defaultConfiguration.download,
      tagBadges: true,
      ...download,
    },
  });

const POSTER_BYTES = Buffer.from("poster");
const POSTER_SHA = createHash("sha256").update(POSTER_BYTES).digest("hex");

describe("applyPosterTagBadgesIfNeeded", () => {
  let posterPath: string;
  let directory: string;
  const createAssets = (downloadedPoster: boolean): DownloadedAssets => ({
    poster: posterPath,
    sceneImages: [],
    downloaded: downloadedPoster ? [posterPath] : [],
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "mdcz-poster-badges-"));
    posterPath = join(directory, "poster.jpg");
    await writeFile(posterPath, POSTER_BYTES);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("draws badges only on a newly produced poster and records the look with the file's hash", async () => {
    const watermarkService = { applyTagBadges: vi.fn().mockResolvedValue(undefined) };
    const input = {
      config: createConfiguration({
        tagBadgeTypes: ["subtitle", "fourK"],
        tagBadgePosition: "bottomRight",
        tagBadgeImageOverrides: true,
      }),
      crawlerData: createCrawlerData(),
      dataDir: "/tmp/data",
      fileInfo: createFileInfo({ isSubtitled: true, subtitleTag: "中文字幕", resolution: "2160P" }),
      logger: { warn: vi.fn() },
      watermarkService,
    };

    const assets = await applyPosterTagBadgesIfNeeded({ ...input, assets: createAssets(true) });

    expect(watermarkService.applyTagBadges).toHaveBeenCalledWith(
      posterPath,
      [expect.objectContaining({ label: "中字" }), expect.objectContaining({ label: "4K" })],
      expect.objectContaining({
        imageOverrides: true,
        position: "bottomRight",
        sizePercent: 100,
        opacity: 100,
        insetPercent: 3,
        onWarn: expect.any(Function),
      }),
    );
    expect(assets.posterRecord).toEqual({ stamp: "subtitle,fourK|bottomRight|100|100|3|images", sha256: POSTER_SHA });

    const kept = createAssets(false);
    await expect(applyPosterTagBadgesIfNeeded({ ...input, assets: kept })).resolves.toBe(kept);
    expect(watermarkService.applyTagBadges).toHaveBeenCalledOnce();
  });

  it.each([
    ["badges are off", { tagBadges: false }],
    ["no enabled badge matches", { tagBadgeTypes: ["subtitle" as const] }],
  ])("records an unbadged poster when %s", async (_case, download) => {
    const watermarkService = { applyTagBadges: vi.fn().mockResolvedValue(undefined) };

    const assets = await applyPosterTagBadgesIfNeeded({
      assets: createAssets(true),
      config: createConfiguration(download),
      crawlerData: createCrawlerData(),
      dataDir: "/tmp/data",
      fileInfo: createFileInfo(),
      logger: { warn: vi.fn() },
      watermarkService,
    });

    expect(watermarkService.applyTagBadges).not.toHaveBeenCalled();
    expect(assets.posterRecord).toEqual({ stamp: "", sha256: POSTER_SHA });
  });

  it("logs rendering failures and records the poster as drawn without badges", async () => {
    const warn = vi.fn();

    const assets = await applyPosterTagBadgesIfNeeded({
      assets: createAssets(true),
      config: createConfiguration({ tagBadgeTypes: ["subtitle"] }),
      crawlerData: createCrawlerData(),
      dataDir: "/tmp/data",
      fileInfo: createFileInfo({ isSubtitled: true }),
      logger: { warn },
      watermarkService: { applyTagBadges: vi.fn().mockRejectedValue(new Error("render failed")) },
    });

    expect(warn).toHaveBeenCalledWith(`Failed to apply poster tag badges for ${posterPath}: render failed`);
    expect(assets.posterRecord).toEqual({ stamp: "", sha256: POSTER_SHA });
  });

  it("checks cancellation before and after rendering", async () => {
    const beforeController = new AbortController();
    beforeController.abort();
    const afterController = new AbortController();
    const applyTagBadges = vi.fn(async () => {
      afterController.abort();
    });
    const input = {
      assets: createAssets(true),
      config: createConfiguration({ tagBadgeTypes: ["subtitle"] }),
      crawlerData: createCrawlerData(),
      dataDir: "/tmp/data",
      fileInfo: createFileInfo({ isSubtitled: true }),
      logger: { warn: vi.fn() },
    };

    await expect(
      applyPosterTagBadgesIfNeeded({
        ...input,
        signal: beforeController.signal,
        watermarkService: { applyTagBadges },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(applyTagBadges).not.toHaveBeenCalled();

    await expect(
      applyPosterTagBadgesIfNeeded({
        ...input,
        signal: afterController.signal,
        watermarkService: { applyTagBadges },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(applyTagBadges).toHaveBeenCalledOnce();
  });
});
