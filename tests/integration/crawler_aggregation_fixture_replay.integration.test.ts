import { readFile } from "node:fs/promises";
import path from "node:path";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { runWithNetworkChannel, runWithScrapeItem } from "@mdcz/runtime/network";
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
  const cases = [
    {
      caseId: "ipzz-907",
      number: "IPZZ-907",
      expectedTitle: "明日葉みつは史上【最大絶頂】 中出し解禁 生ハメオーガズム",
      expectedActors: ["明日葉みつは"],
    },
    {
      caseId: "snos-301",
      number: "SNOS-301",
      expectedTitle: "【主従逆転】仕えるだけじゃ物足りない。本当はわたくしに支配されたいんでしょう？ 浅野こころ",
      expectedActors: ["浅野こころ"],
    },
    {
      caseId: "start-608",
      number: "START-608",
      expectedTitle: "性欲処理専門セックス外来医院27 特別編 SODSTAR 神木麗 妻として、看護師として、性医療に生きる。",
      expectedActors: ["神木麗"],
    },
  ];

  describe.each(cases)("aggregating $number ($caseId)", ({ caseId, number, expectedTitle, expectedActors }) => {
    it("aggregates DMM, DMM_TV, and AVBASE concurrently with recorded network data", async () => {
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
      expect(aggregated.data.title.replace(/\s*（BOD）$/u, "")).toBe(expectedTitle);
      expect(aggregated.data.actors).toEqual(expectedActors);
      expect(aggregated.data.thumb_url).toBeTruthy();
      expect(aggregated.data.poster_url).toBeTruthy();

      expect(aggregated.stats.successCount).toBe(3);
      expect(aggregated.stats.failedCount).toBe(0);

      await provider.shutdown();
    });

    it("replays media asset requests with mock media fallback", async () => {
      const manifestPath = path.join(fixturesRoot, caseId, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const interaction = manifest.interactions.find(
        (candidate: { channel: string; response?: { status: number }; request: { method: string } }) =>
          candidate.channel === "media" && (candidate.response?.status === 200 || candidate.response?.status === 206),
      );
      if (!interaction) throw new Error(`No successful interaction in manifest for ${caseId}`);

      const mediaReplay = new NetworkReplayClient({ fixturesRoot });

      const item = { itemId: caseId, relativePath: `${number}.mp4`, caseId };
      await runWithScrapeItem(item, async () => {
        await runWithNetworkChannel("media", async () => {
          const content = await mediaReplay.getContent(interaction.request.url);
          expect(content.byteLength).toBeGreaterThan(0);
        });
      });
    });
  });
});
