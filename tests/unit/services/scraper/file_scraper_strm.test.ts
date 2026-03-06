import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import type { FileOrganizer, OrganizePlan } from "@main/services/scraper/FileOrganizer";
import { FileScraper } from "@main/services/scraper/FileScraper";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { TranslateService } from "@main/services/scraper/TranslateService";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { TestConfigManager } from "./helpers";

describe("FileScraper .strm support", () => {
  it("extracts number from .strm filename and still generates NFO", async () => {
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        downloadNfo: true,
      },
    });

    const crawlerData: CrawlerData = {
      title: "Sample STRM Title",
      number: "ABC-123",
      durationSeconds: 5400,
      actors: ["Actor A"],
      genres: ["Tag A"],
      sample_images: [],
      website: Website.DMM,
    };

    const plan: OrganizePlan = {
      outputDir: "/output/ABC-123",
      targetVideoPath: "/output/ABC-123/ABC-123.strm",
      nfoPath: "/output/ABC-123/ABC-123.nfo",
    };

    const writeNfo = vi.fn().mockResolvedValue(plan.nfoPath);

    const scraper = new FileScraper({
      configManager: new TestConfigManager(config),
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue({
          data: crawlerData,
          sources: {},
          stats: {
            totalSites: 1,
            successCount: 1,
            failedCount: 0,
            siteResults: [],
            totalElapsedMs: 1,
          },
        }),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn().mockResolvedValue(crawlerData),
      } as unknown as TranslateService,
      nfoGenerator: {
        writeNfo,
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({
          downloaded: [],
          sceneImages: [],
        }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockResolvedValue(undefined),
        organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        cleanupUnwantedFiles: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
    });

    const result = await scraper.scrapeFile("/tmp/ABC-123.strm", { fileIndex: 1, totalFiles: 1 });

    expect(result.status).toBe("success");
    expect(result.fileInfo.number).toBe("ABC-123");
    expect(result.fileInfo.extension).toBe(".strm");
    expect(writeNfo).toHaveBeenCalledTimes(1);
  });
});
