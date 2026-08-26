import { configurationSchema, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData, DownloadedAssets, FileInfo } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
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

const createAssets = (downloadedPoster: boolean): DownloadedAssets => ({
  poster: "/tmp/poster.jpg",
  sceneImages: [],
  downloaded: downloadedPoster ? ["/tmp/poster.jpg"] : [],
});

const createConfiguration = (download: Partial<typeof defaultConfiguration.download> = {}) =>
  configurationSchema.parse({
    download: {
      ...defaultConfiguration.download,
      tagBadges: true,
      ...download,
    },
  });

describe("applyPosterTagBadgesIfNeeded", () => {
  it("applies supported tag badges only to newly downloaded posters", async () => {
    const config = createConfiguration({
      tagBadgeTypes: ["subtitle", "fourK"],
      tagBadgePosition: "bottomRight",
      tagBadgeImageOverrides: true,
    });
    const watermarkService = {
      applyTagBadges: vi.fn().mockResolvedValue(undefined),
    };

    await applyPosterTagBadgesIfNeeded({
      assets: createAssets(true),
      config,
      crawlerData: createCrawlerData(),
      dataDir: "/tmp/data",
      fileInfo: createFileInfo({
        isSubtitled: true,
        subtitleTag: "中文字幕",
        resolution: "2160P",
      }),
      logger: {
        warn: vi.fn(),
      },
      watermarkService,
    });

    expect(watermarkService.applyTagBadges).toHaveBeenCalledWith(
      "/tmp/poster.jpg",
      [expect.objectContaining({ label: "中字" }), expect.objectContaining({ label: "4K" })],
      "bottomRight",
      expect.objectContaining({ imageOverrides: true, onWarn: expect.any(Function) }),
    );
  });

  it("skips disabled badges and preserved posters", async () => {
    const watermarkService = {
      applyTagBadges: vi.fn().mockResolvedValue(undefined),
    };
    const disabledConfig = createConfiguration({ tagBadges: false });
    const enabledConfig = createConfiguration();

    await applyPosterTagBadgesIfNeeded({
      assets: createAssets(true),
      config: disabledConfig,
      crawlerData: createCrawlerData(),
      dataDir: "/tmp/data",
      fileInfo: createFileInfo({ isSubtitled: true }),
      logger: { warn: vi.fn() },
      watermarkService,
    });
    await applyPosterTagBadgesIfNeeded({
      assets: createAssets(false),
      config: enabledConfig,
      crawlerData: createCrawlerData(),
      dataDir: "/tmp/data",
      fileInfo: createFileInfo({ isSubtitled: true }),
      logger: { warn: vi.fn() },
      watermarkService,
    });

    expect(watermarkService.applyTagBadges).not.toHaveBeenCalled();
  });

  it("skips downloaded posters without matching enabled badge definitions", async () => {
    const watermarkService = {
      applyTagBadges: vi.fn().mockResolvedValue(undefined),
    };

    await applyPosterTagBadgesIfNeeded({
      assets: createAssets(true),
      config: createConfiguration({ tagBadgeTypes: ["subtitle"] }),
      crawlerData: createCrawlerData(),
      dataDir: "/tmp/data",
      fileInfo: createFileInfo(),
      logger: { warn: vi.fn() },
      watermarkService,
    });

    expect(watermarkService.applyTagBadges).not.toHaveBeenCalled();
  });

  it("logs rendering failures and preserves the downloaded asset result", async () => {
    const assets = createAssets(true);
    const warn = vi.fn();

    await expect(
      applyPosterTagBadgesIfNeeded({
        assets,
        config: createConfiguration({ tagBadgeTypes: ["subtitle"] }),
        crawlerData: createCrawlerData(),
        dataDir: "/tmp/data",
        fileInfo: createFileInfo({ isSubtitled: true }),
        logger: { warn },
        watermarkService: {
          applyTagBadges: vi.fn().mockRejectedValue(new Error("render failed")),
        },
      }),
    ).resolves.toBe(assets);
    expect(warn).toHaveBeenCalledWith("Failed to apply poster tag badges for /tmp/poster.jpg: render failed");
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
