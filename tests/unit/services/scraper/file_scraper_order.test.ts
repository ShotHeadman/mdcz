import { type Configuration, configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import { createFileScraper } from "@main/services/scraper/FileScraper";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import type { CrawlerInput, CrawlerResponse } from "@mdcz/runtime/crawler/base/types";
import { NetworkClient } from "@mdcz/runtime/network";
import {
  AggregationService,
  DownloadManager,
  FileOrganizer,
  MemoryImageHostCooldownStore,
  NfoGenerator,
  TranslateService,
} from "@mdcz/runtime/scrape";
import { Website } from "@mdcz/shared/enums";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockConfigManager } from "../../../helpers/scraper";

class OrderedStubCrawlerProvider extends CrawlerProvider {
  readonly calledSites: Website[] = [];
  readonly calledNumbers: string[] = [];

  constructor() {
    super({
      fetchGateway: new FetchGateway(new NetworkClient()),
    });
  }

  override async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    this.calledNumbers.push(input.number);
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

const createConfig = (scrape: Partial<Configuration["scrape"]> = {}): Configuration => {
  return configurationSchema.parse({
    ...defaultConfiguration,
    scrape: {
      ...defaultConfiguration.scrape,
      sites: [Website.JAVBUS, Website.JAVDB, Website.DMM],
      siteOrder: [Website.JAVBUS, Website.JAVDB, Website.DMM],
      ...scrape,
    },
  });
};

describe("FileScraper site aggregation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attempts all enabled sites via aggregation", async () => {
    const crawlerProvider = new OrderedStubCrawlerProvider();
    mockConfigManager(createConfig());
    const scraper = createFileScraper({
      aggregationService: new AggregationService(crawlerProvider),
      translateService: new TranslateService(new NetworkClient()),
      nfoGenerator: new NfoGenerator(),
      downloadManager: new DownloadManager(new NetworkClient(), {
        imageHostCooldownStore: new MemoryImageHostCooldownStore(),
      }),
      fileOrganizer: new FileOrganizer(),
      signalService: new SignalService(null),
    });

    const result = await scraper.scrapeFile("/tmp/FNS-139.mp4", { fileIndex: 1, totalFiles: 1 });

    expect(result.status).toBe("failed");
    expect(crawlerProvider.calledSites.sort()).toEqual([Website.DMM, Website.JAVBUS, Website.JAVDB].sort());
  });
  it("uses configured filename ignore tokens before aggregation receives the authoritative number", async () => {
    const crawlerProvider = new OrderedStubCrawlerProvider();
    const filePath = "/tmp/[7SiS-001]+ ABF-252.mp4";
    mockConfigManager(
      createConfig({
        filenameIgnoreTokens: ["[7sis-001]+"],
      }),
    );
    const scraper = createFileScraper({
      aggregationService: new AggregationService(crawlerProvider),
      translateService: new TranslateService(new NetworkClient()),
      nfoGenerator: new NfoGenerator(),
      downloadManager: new DownloadManager(new NetworkClient(), {
        imageHostCooldownStore: new MemoryImageHostCooldownStore(),
      }),
      fileOrganizer: new FileOrganizer(),
      signalService: new SignalService(null),
    });

    const result = await scraper.scrapeFile(filePath);

    expect(crawlerProvider.calledNumbers).toEqual(["ABF-252", "ABF-252", "ABF-252"]);
    expect(result.fileName).toBe("[7SiS-001]+ ABF-252");
    expect(result.relativePath).toBe(filePath);
    expect(result.crawlerData?.number ?? result.fileName).toContain("ABF-252");
  });
});
