import path from "node:path";
import { FetchGateway } from "@mdcz/runtime/crawler";
import { AvbaseCrawler } from "@mdcz/runtime/crawler/sites/avbase";
import { DmmCrawler } from "@mdcz/runtime/crawler/sites/dmm";
import { DmmTvCrawler } from "@mdcz/runtime/crawler/sites/dmm/dmm_tv";
import { NetworkReplayClient, runWithCrawlerSourceContext, runWithScrapeItemContext } from "@mdcz/runtime/network";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

const fixturesRoot = path.resolve(process.cwd(), "tests/fixtures/network");

interface FixtureCaseExpectation {
  caseId: string;
  number: string;
  expectedTitle: string;
  expectedActors: string[];
  expectedStudio?: string;
  expectedDirector?: string;
}

const fixtureCases: FixtureCaseExpectation[] = [
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

describe("Crawler actual fixture replay", () => {
  describe.each(fixtureCases)("case $number ($caseId)", ({
    caseId,
    number,
    expectedTitle,
    expectedActors,
    expectedStudio,
    expectedDirector,
  }) => {
    it("parses DMM recorded network data", async () => {
      const replay = new NetworkReplayClient({ fixturesRoot });
      const item = { itemId: caseId, relativePath: `${number}.mp4`, caseId };

      const response = await runWithScrapeItemContext(
        item,
        async () =>
          await runWithCrawlerSourceContext(Website.DMM, async () => {
            const crawler = new DmmCrawler({ gateway: new FetchGateway(replay) });
            return await crawler.crawl({ number, site: Website.DMM });
          }),
      );

      expect(response.result.success).toBe(true);
      if (!response.result.success) throw new Error("Expected success");

      const data = response.result.data;
      expect(data.website).toBe(Website.DMM);
      expect(data.number).toBe(number);
      expect(data.title).toBe(expectedTitle);
      expect(data.actors).toEqual(expectedActors);
      if (expectedStudio) expect(data.studio).toBe(expectedStudio);
      if (expectedDirector) expect(data.director).toBe(expectedDirector);
      expect(data.thumb_url).toBeTruthy();
      expect(data.poster_url).toBeTruthy();
      expect(data.genres?.length).toBeGreaterThan(0);
    });

    it("parses DMM_TV recorded network data", async () => {
      const replay = new NetworkReplayClient({
        fixturesRoot,
        network: { getRetryCount: () => 1 },
      });
      const item = { itemId: caseId, relativePath: `${number}.mp4`, caseId };

      const response = await runWithScrapeItemContext(
        item,
        async () =>
          await runWithCrawlerSourceContext(Website.DMM_TV, async () => {
            const crawler = new DmmTvCrawler({ gateway: new FetchGateway(replay) });
            return await crawler.crawl({ number, site: Website.DMM_TV });
          }),
      );

      expect(response.result.success).toBe(true);
      if (!response.result.success) throw new Error("Expected success");

      const data = response.result.data;
      expect(data.website).toBe(Website.DMM_TV);
      expect(data.number).toBe(number);
      expect(data.title).toBe(expectedTitle);
      expect(data.actors).toEqual(expectedActors);
      expect(data.thumb_url).toBeTruthy();
      expect(data.poster_url).toBeTruthy();
    });

    it("parses AVBASE recorded network data", async () => {
      const replay = new NetworkReplayClient({ fixturesRoot });
      const item = { itemId: caseId, relativePath: `${number}.mp4`, caseId };

      const response = await runWithScrapeItemContext(
        item,
        async () =>
          await runWithCrawlerSourceContext(Website.AVBASE, async () => {
            const crawler = new AvbaseCrawler({ gateway: new FetchGateway(replay) });
            return await crawler.crawl({ number, site: Website.AVBASE });
          }),
      );

      expect(response.result.success).toBe(true);
      if (!response.result.success) throw new Error("Expected success");

      const data = response.result.data;
      expect(data.website).toBe(Website.AVBASE);
      expect(data.number).toBe(number);
      expect(data.title.replace(/\s*（BOD）$/u, "")).toBe(expectedTitle);
      expect(data.actors).toEqual(expectedActors);
      expect(data.thumb_url).toBeTruthy();
      expect(data.poster_url).toBeTruthy();
      expect(data.genres?.length).toBeGreaterThan(0);
    });
  });
});
