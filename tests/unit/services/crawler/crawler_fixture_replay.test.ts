import { existsSync } from "node:fs";
import path from "node:path";
import { FetchGateway } from "@mdcz/runtime/crawler";
import { getCrawlerConstructor } from "@mdcz/runtime/crawler/registry";
import { AvbaseCrawler } from "@mdcz/runtime/crawler/sites/avbase";
import { DmmCrawler } from "@mdcz/runtime/crawler/sites/dmm";
import { DmmTvCrawler } from "@mdcz/runtime/crawler/sites/dmm/dmm_tv";
import type { NetworkClientOptions } from "@mdcz/runtime/network";
import { runWithCrawlerSource, runWithScrapeItem } from "@mdcz/runtime/network";
import { NetworkFixtureClient } from "@mdcz/runtime/network/NetworkFixtureClient";
import { extractNumber } from "@mdcz/runtime/scrape/utils/number";
import { Website } from "@mdcz/shared/enums";
import { validateManualScrapeUrl } from "@mdcz/shared/manualScrapeUrl";
import { describe, expect, it } from "vitest";

const fixturesRoot = path.resolve(process.cwd(), "tests/fixtures/network");
const hasNetworkFixtures =
  existsSync(fixturesRoot) &&
  existsSync(path.join(fixturesRoot, "snos-301", "manifest.json"));

const replayClient = (network?: NetworkClientOptions) =>
  new NetworkFixtureClient({
    recordRoot: fixturesRoot,
    replayRoots: [fixturesRoot],
    mode: () => "replay",
    mockMediaRoot: path.resolve(process.cwd(), "tests/fixtures/mock-media"),
    network,
  });

interface FixtureCaseExpectation {
  caseId: string;
  number: string;
  expectedTitle: string;
  /** AVBASE drops actor names that end a title. */
  expectedAvbaseTitle?: string;
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
    expectedAvbaseTitle: "【主従逆転】仕えるだけじゃ物足りない。本当はわたくしに支配されたいんでしょう？",
    expectedActors: ["浅野こころ"],
  },
  {
    caseId: "snos-334",
    number: "SNOS-334",
    expectedTitle:
      "最強ビジュOLさん、出張先で死ぬほど嫌いな中年上司と相部屋… でも過激セクハラにまさかの快楽堕ちしちゃう！ 瀬戸環奈",
    expectedAvbaseTitle:
      "最強ビジュOLさん、出張先で死ぬほど嫌いな中年上司と相部屋… でも過激セクハラにまさかの快楽堕ちしちゃう！",
    expectedActors: ["瀬戸環奈"],
  },
];

describe.skipIf(!hasNetworkFixtures)("Crawler actual fixture replay", () => {
  it.each([
    {
      site: Website.OFFICIAL,
      number: "SNOS-301",
      actors: ["浅野こころ"],
      duration: 140 * 60,
      url: "https://s1s1s1.com/works/detail/snos301",
    },
    {
      site: Website.ONEPONDO,
      number: "1PON-100524_001",
      actors: ["ルナ"],
      duration: 3217,
      url: "https://www.1pondo.tv/moviepages/100524_001/index.html",
    },
    {
      site: Website.TENMUSUME,
      number: "10MU-100524_01",
      actors: ["川口あかり"],
      duration: 3543,
      url: "https://www.10musume.com/moviepages/100524_01/index.html",
    },
    {
      site: Website.CARIBBEANCOM,
      number: "CARIB-100524-001",
      actors: ["中田みなみ"],
      duration: 3624,
      url: "https://www.caribbeancom.com/moviepages/100524-001/index.html",
    },
    {
      site: Website.HEYZO,
      number: "HEYZO-3806",
      actors: ["さとみ"],
      duration: 3702,
      url: "https://www.heyzo.com/moviepages/3806/index.html",
    },
  ])("replays $site metadata and rejects a mismatched manual landing page", async ({
    site,
    number,
    actors,
    duration,
    url,
  }) => {
    const Crawler = getCrawlerConstructor(site);
    if (!Crawler) throw new Error(`Missing crawler ${site}`);
    const replay = replayClient();
    const crawl = (requestedNumber: string, manual: boolean) =>
      runWithScrapeItem({ caseId: number.toLowerCase(), execution: {} }, () =>
        runWithCrawlerSource(site, () =>
          new Crawler({ gateway: new FetchGateway(replay) }).crawl({
            number: requestedNumber,
            site,
            options: manual ? { detailUrl: url } : undefined,
          }),
        ),
      );
    expect(extractNumber(`${number}.mp4`)).toBe(number);
    expect(validateManualScrapeUrl(url, { javdbUrl: "", javbusUrl: "" })).toMatchObject({
      valid: true,
      route: { site, detailUrl: url },
    });
    const response = await crawl(number, false);
    expect(response.result).toMatchObject({
      success: true,
      data: { number, actors, durationSeconds: duration, website: site },
    });
    if (!response.result.success) throw new Error(response.result.error);
    expect(response.result.data.title).toBeTruthy();
    expect(response.result.data.thumb_url).toMatch(/^https:\/\//u);
    expect((await crawl("WRONG-999", true)).result).toMatchObject({ success: false, reason: "not_found" });
    expect(replay.missingInteractions).toEqual([]);
  });

  describe.each(fixtureCases)("case $number ($caseId)", ({
    caseId,
    number,
    expectedTitle,
    expectedAvbaseTitle,
    expectedActors,
    expectedStudio,
    expectedDirector,
  }) => {
    it("parses DMM recorded network data", async () => {
      const replay = replayClient();
      const item = { caseId, execution: {} };

      const response = await runWithScrapeItem(
        item,
        async () =>
          await runWithCrawlerSource(Website.DMM, async () => {
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
      expect(data.plot).toBeTruthy();
      expect(data.plot).not.toMatch(/<br/iu);
      expect(data.thumb_url).toBeTruthy();
      expect(data.poster_url).toBeTruthy();
      expect(data.genres?.length).toBeGreaterThan(0);
    });

    it("parses DMM_TV recorded network data", async () => {
      const replay = replayClient({ getRetryCount: () => 1 });
      const item = { caseId, execution: {} };

      const response = await runWithScrapeItem(
        item,
        async () =>
          await runWithCrawlerSource(Website.DMM_TV, async () => {
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
      expect(data.plot).toBeTruthy();
      expect(data.plot).not.toMatch(/<br/iu);
      expect(data.thumb_url).toBeTruthy();
      expect(data.poster_url).toBeTruthy();
    });

    it("parses AVBASE recorded network data", async () => {
      const replay = replayClient();
      const item = { caseId, execution: {} };

      const response = await runWithScrapeItem(
        item,
        async () =>
          await runWithCrawlerSource(Website.AVBASE, async () => {
            const crawler = new AvbaseCrawler({ gateway: new FetchGateway(replay) });
            return await crawler.crawl({ number, site: Website.AVBASE });
          }),
      );

      expect(response.result.success).toBe(true);
      if (!response.result.success) throw new Error("Expected success");

      const data = response.result.data;
      expect(data.website).toBe(Website.AVBASE);
      expect(data.number).toBe(number);
      expect(data.title).toBe(expectedAvbaseTitle ?? expectedTitle);
      expect(data.actors).toEqual(expectedActors);
      expect(data.thumb_url).toBeTruthy();
      expect(data.poster_url).toBeTruthy();
      expect(data.genres?.length).toBeGreaterThan(0);
    });
  });
});
