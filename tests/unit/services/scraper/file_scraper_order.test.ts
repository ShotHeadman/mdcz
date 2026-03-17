import { type Configuration, configurationSchema, defaultConfiguration } from "@main/services/config";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import type { CrawlerInput, CrawlerResponse } from "@main/services/crawler/base/types";
import { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import { AggregationService } from "@main/services/scraper/aggregation";
import { DownloadManager } from "@main/services/scraper/DownloadManager";
import { FileOrganizer } from "@main/services/scraper/FileOrganizer";
import { FileScraper } from "@main/services/scraper/FileScraper";
import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { TranslateService } from "@main/services/scraper/TranslateService";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";
import { TestConfigManager } from "./helpers";

class OrderedStubCrawlerProvider extends CrawlerProvider {
  readonly calledSites: Website[] = [];

  constructor() {
    super({
      fetchGateway: new FetchGateway(new NetworkClient()),
    });
  }

  override async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    this.calledSites.push(input.site);
    return {
      input,
      elapsedMs: 1,
      result: {
        success: false,
        error: `stub miss: ${input.site}`,
      },
    };
  }
}

const createConfig = (): Configuration => {
  return configurationSchema.parse({
    ...defaultConfiguration,
    scrape: {
      ...defaultConfiguration.scrape,
      enabledSites: [Website.JAVBUS, Website.JAVDB, Website.DMM],
      siteOrder: [Website.JAVBUS, Website.JAVDB, Website.DMM],
    },
  });
};

describe("FileScraper site aggregation", () => {
  it("attempts all enabled sites via aggregation", async () => {
    const crawlerProvider = new OrderedStubCrawlerProvider();
    const scraper = new FileScraper({
      configManager: new TestConfigManager(createConfig()),
      aggregationService: new AggregationService(crawlerProvider),
      translateService: new TranslateService(new NetworkClient()),
      nfoGenerator: new NfoGenerator(),
      downloadManager: new DownloadManager(new NetworkClient()),
      fileOrganizer: new FileOrganizer(),
      signalService: new SignalService(null),
    });

    const result = await scraper.scrapeFile("/tmp/FNS-139.mp4", { fileIndex: 1, totalFiles: 1 });

    expect(result.status).toBe("failed");
    expect(crawlerProvider.calledSites.sort()).toEqual([Website.DMM, Website.JAVBUS, Website.JAVDB].sort());
  });
});
