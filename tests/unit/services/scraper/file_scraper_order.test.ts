import { type Configuration, configurationSchema, defaultConfiguration } from "@main/services/config";
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
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createTempDirectory } from "../../../harness/tempDirectory";
import { createFileScraper, mockConfigManager, prepareFile } from "../../../helpers/scraper";

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

  it("uses configured filename ignore tokens before aggregation receives the authoritative number", async () => {
    const crawlerProvider = new OrderedStubCrawlerProvider();
    const directory = await createTempDirectory("scrape-ignore-tokens");
    onTestFinished(directory.cleanup);
    const filePath = join(directory.path, "[7SiS-001]+ ABF-252.mp4");
    await writeFile(filePath, "video");
    const config = createConfig({
      filenameIgnoreTokens: ["[7sis-001]+"],
    });
    mockConfigManager(config);
    const scraper = createFileScraper({
      aggregationService: new AggregationService(crawlerProvider, { config }),
      translateService: new TranslateService(new NetworkClient()),
      nfoGenerator: new NfoGenerator(),
      downloadManager: new DownloadManager(new NetworkClient(), {
        imageHostCooldownStore: new MemoryImageHostCooldownStore(),
      }),
      fileOrganizer: new FileOrganizer(),
    });

    const result = await prepareFile(scraper, filePath, undefined, undefined, {
      roots: [{ id: "test", hostPath: "/tmp" }],
    });
    if (result.status === "prepared") throw new Error("Expected all configured crawlers to miss");

    expect(crawlerProvider.calledNumbers).toEqual(["ABF-252", "ABF-252", "ABF-252"]);
    expect(result.fileName).toBe("[7SiS-001]+ ABF-252");
    expect(result.relativePath).toBe(filePath);
    expect(result.crawlerData?.number ?? result.fileName).toContain("ABF-252");
  });
});

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
