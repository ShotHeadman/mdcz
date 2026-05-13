import { join } from "node:path";
import { defaultConfiguration } from "@main/services/config";
import { PrimaryImageAssetDownloader } from "@main/services/scraper/download/assets/PrimaryImageAssetDownloader";
import type { DownloadExecutionContext } from "@main/services/scraper/download/assets/types";
import type { PosterImageDerivationService } from "@main/services/scraper/download/PosterImageDerivationService";
import { Website } from "@shared/enums";
import type { CrawlerData, DownloadedAssets } from "@shared/types";
import { describe, expect, it, vi } from "vitest";

describe("PrimaryImageAssetDownloader", () => {
  it("records thumb source URL when deriving a poster from thumb", async () => {
    const outputDir = "/tmp/mdcz-primary-image-test";
    const thumbPath = join(outputDir, "thumb.jpg");
    const posterPath = join(outputDir, "poster.jpg");
    const posterDerivationService = {
      deriveFromThumbIfNeeded: vi.fn(async () => ({ status: "derived" as const, path: posterPath })),
    } as unknown as PosterImageDerivationService;
    const data: CrawlerData = {
      title: "Sample",
      number: "ABC-123",
      actors: [],
      genres: [],
      scene_images: [],
      website: Website.DMM,
      thumb_url: "https://example.com/thumb.jpg",
      poster_url: "https://example.com/poster.jpg",
    };
    const assets: DownloadedAssets = {
      thumb: thumbPath,
      sceneImages: [],
      downloaded: [],
    };
    const context = {
      assets,
      imageDownloader: {},
      logger: { warn: vi.fn() },
      plan: {
        outputDir,
        movieBaseName: "ABC-123",
        assetFileNames: {
          thumb: "thumb.jpg",
          poster: "poster.jpg",
          fanart: "fanart.jpg",
          nfo: "ABC-123.nfo",
          trailer: "trailer.mp4",
        },
        data,
        config: {
          ...defaultConfiguration,
          download: {
            ...defaultConfiguration.download,
            downloadThumb: false,
            downloadPoster: true,
          },
        },
        imageAlternatives: {},
        forceReplace: {},
        assetDecisions: {},
      },
    } as unknown as DownloadExecutionContext;

    await new PrimaryImageAssetDownloader(posterDerivationService).download(context);

    expect(posterDerivationService.deriveFromThumbIfNeeded).toHaveBeenCalledWith({
      posterPath: undefined,
      targetPath: posterPath,
      thumbPath,
    });
    expect(assets.poster).toBe(posterPath);
    expect(assets.downloaded).toEqual([posterPath]);
    expect(data.poster_source_url).toBe("https://example.com/thumb.jpg");
  });
});
