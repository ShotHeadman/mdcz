import path from "node:path";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { runWithScrapeItem } from "@mdcz/runtime/network";
import { NetworkReplayClient } from "@mdcz/runtime/network/NetworkFixtureClient";
import { AggregationService } from "@mdcz/runtime/scrape";
import { configurationSchema, defaultConfiguration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

const fixturesRoot = path.resolve(process.cwd(), "tests/fixtures/network");

const makeScrapeConfig = (sites: Website[]) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    scrape: {
      ...defaultConfiguration.scrape,
      sites,
    },
    aggregation: {
      ...defaultConfiguration.aggregation,
      perCrawlerTimeoutMs: 30_000,
      globalTimeoutMs: 60_000,
    },
  });

describe("Crawler aggregation real fixture replay integration", () => {
  it("aggregates DMM, DMM_TV, and AVBASE concurrently with recorded network data", async () => {
    const caseId = "ipzz-907";
    const number = "IPZZ-907";
    const replay = new NetworkReplayClient({
      fixturesRoot,
      network: { getRetryCount: () => 1 },
    });
    const provider = new CrawlerProvider({
      fetchGateway: new FetchGateway(replay),
      siteRequestConfigRegistrar: replay,
    });

    const item = { itemId: caseId, relativePath: `${number}.mp4`, caseId };
    const config = makeScrapeConfig([Website.DMM, Website.DMM_TV, Website.AVBASE]);
    const service = new AggregationService(provider);

    const aggregated = await runWithScrapeItem(item, async () => {
      return await service.aggregate(number, config);
    });

    expect(aggregated).not.toBeNull();
    if (!aggregated) throw new Error("Expected aggregated result");

    expect(aggregated.data.number).toBe(number);
    expect(aggregated.sources.title).toBe(Website.AVBASE);
    expect(aggregated.data.title.replace(/\s*（BOD）$/u, "")).toBe(
      "明日葉みつは史上【最大絶頂】 中出し解禁 生ハメオーガズム",
    );
    expect(aggregated.data.actors).toEqual(["明日葉みつは"]);
    expect(aggregated.data.thumb_url).toBeTruthy();
    expect(aggregated.data.poster_url).toBeTruthy();

    expect(aggregated.stats.successCount).toBe(3);
    expect(aggregated.stats.failedCount).toBe(0);

    await provider.shutdown();
  });
});
