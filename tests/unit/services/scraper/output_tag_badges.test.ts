import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { applyPosterTagBadgesIfNeeded } from "@main/services/scraper/output";
import { Website } from "@shared/enums";
import type { CrawlerData, DownloadedAssets, FileInfo } from "@shared/types";
import { describe, expect, it, vi } from "vitest";

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

describe("applyPosterTagBadgesIfNeeded", () => {
  it("applies supported tag badges only to newly downloaded posters", async () => {
    const config = configurationSchema.parse({
      download: {
        ...defaultConfiguration.download,
        tagBadges: true,
        tagBadgeTypes: ["subtitle", "fourK"],
        tagBadgePosition: "bottomRight",
      },
    });
    const watermarkService = {
      applyTagBadges: vi.fn().mockResolvedValue(undefined),
    };

    await applyPosterTagBadgesIfNeeded({
      assets: createAssets(true),
      config,
      crawlerData: createCrawlerData(),
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
    );
  });

  it("skips preserved posters even when tag badges are enabled", async () => {
    const config = configurationSchema.parse({
      download: {
        ...defaultConfiguration.download,
        tagBadges: true,
      },
    });
    const watermarkService = {
      applyTagBadges: vi.fn().mockResolvedValue(undefined),
    };

    await applyPosterTagBadgesIfNeeded({
      assets: createAssets(false),
      config,
      crawlerData: createCrawlerData(),
      fileInfo: createFileInfo({
        isSubtitled: true,
        subtitleTag: "中文字幕",
      }),
      logger: {
        warn: vi.fn(),
      },
      watermarkService,
    });

    expect(watermarkService.applyTagBadges).not.toHaveBeenCalled();
  });
});
