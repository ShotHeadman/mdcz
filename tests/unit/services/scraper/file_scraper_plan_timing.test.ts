import type { ActorImageService } from "@main/services/ActorImageService";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import { createFileScraper } from "@main/services/scraper/FileScraper";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { FileOrganizer, OrganizePlan, TranslateService } from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockConfigManager } from "./helpers";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Original Title",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

describe("FileScraper plan timing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("plans output paths from translated metadata so naming stays aligned with maintenance", async () => {
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        generateNfo: false,
        downloadThumb: false,
        downloadPoster: false,
        downloadFanart: false,
        downloadSceneImages: false,
        downloadTrailer: false,
      },
      naming: {
        ...defaultConfiguration.naming,
        folderTemplate: "{number}-{title}",
        fileTemplate: "{number}-{title}",
      },
    });
    const aggregatedData = createCrawlerData();
    const translatedData = createCrawlerData({
      title_zh: "翻译标题",
    });
    const plan: OrganizePlan = {
      outputDir: "/output/translated",
      targetVideoPath: "/output/translated/ABC-123.mp4",
      nfoPath: "/output/translated/ABC-123.nfo",
    };
    const fileOrganizer = {
      plan: vi.fn().mockReturnValue(plan),
      ensureOutputReady: vi.fn().mockImplementation(async (nextPlan: OrganizePlan) => nextPlan),
      organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
    } as unknown as FileOrganizer;
    const actorImageService = {
      prepareActorProfilesForMovie: vi.fn().mockResolvedValue(undefined),
    } as unknown as ActorImageService;
    mockConfigManager(config);
    const scraper = createFileScraper({
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue({
          data: aggregatedData,
          sources: {},
          imageAlternatives: {
            thumb_url: [],
            poster_url: [],
            fanart_url: [],
            scene_images: [],
          },
          stats: {
            totalSites: 1,
            successCount: 1,
            failedCount: 0,
            skippedCount: 0,
            siteResults: [],
            totalElapsedMs: 1,
          },
        }),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn().mockResolvedValue(translatedData),
      } as unknown as TranslateService,
      nfoGenerator: {
        writeNfo: vi.fn(),
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({
          downloaded: [],
          sceneImages: [],
        }),
      } as unknown as DownloadManager,
      fileOrganizer,
      signalService: new SignalService(null),
      actorImageService,
    });

    await scraper.scrapeFile("/tmp/ABC-123.mp4", { fileIndex: 1, totalFiles: 1 });

    expect(fileOrganizer.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        number: "ABC-123",
      }),
      translatedData,
      expect.any(Object),
      undefined,
      {
        executionMode: "batch",
      },
    );
  });
});
