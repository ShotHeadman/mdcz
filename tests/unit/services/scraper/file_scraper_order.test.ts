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
import { type Configuration, configurationSchema, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createTempDirectory } from "../../../harness/tempDirectory";
import { createFileScraper, prepareFile } from "../../../helpers/scraper";

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
        reason: "not_found",
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
    const scraper = createFileScraper({
      getConfiguration: async () => config,
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

  it.each([
    { name: "searches again with a number the AI reads from the name", answer: "MEYD-911", searched: ["MEYD-911"] },
    { name: "keeps the miss when the answer is not in the name", answer: "SSIS-123", searched: [] },
    { name: "keeps the miss when the AI request fails", answer: new Error("HTTP 500"), searched: [] },
    { name: "does not ask while the fallback is off", answer: "MEYD-911", fallback: false, searched: [], asked: 0 },
    {
      name: "does not second-guess a mapped number",
      answer: "MEYD-911",
      mappings: { "98T.LA": "ABC-123" },
      searched: [],
      asked: 0,
    },
  ])("$name", async ({ answer, searched, fallback = true, mappings = {}, asked = 1 }) => {
    const crawlerProvider = new OrderedStubCrawlerProvider();
    const directory = await createTempDirectory("scrape-ai-number");
    onTestFinished(directory.cleanup);
    const filePath = join(directory.path, "www.98T.la@MEYD-911-U.mp4");
    await writeFile(filePath, "video");
    const config = createConfig({ aiNumberFallback: fallback, numberMappings: mappings });
    const readFileNumber = vi.fn(async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    });
    const scraper = createFileScraper({
      getConfiguration: async () => config,
      aggregationService: new AggregationService(crawlerProvider, { config }),
      translateService: new TranslateService(new NetworkClient()),
      readFileNumber,
      nfoGenerator: new NfoGenerator(),
      downloadManager: new DownloadManager(new NetworkClient(), {
        imageHostCooldownStore: new MemoryImageHostCooldownStore(),
      }),
      fileOrganizer: new FileOrganizer(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await prepareFile(scraper, filePath, undefined, undefined, {
      roots: [{ id: "test", hostPath: "/tmp" }],
    });

    const parsed = mappings["98T.LA"] ?? "WWW-98T";
    expect(readFileNumber).toHaveBeenCalledTimes(asked);
    if (asked) expect(readFileNumber).toHaveBeenCalledWith("www.98T.la@MEYD-911-U", parsed, config, undefined);
    expect([...new Set(crawlerProvider.calledNumbers)]).toEqual([parsed, ...searched]);
    expect(result.status === "failed" && result.pending?.kind).toBe("not_found");
  });
});

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
