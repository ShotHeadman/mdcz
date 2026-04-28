import { AvwikidbCrawler } from "@main/services/crawler/sites/avwikidb";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

const createHomeHtml = (buildId: string): string =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ buildId })}</script></body></html>`;

const createWorkPayload = (overrides: { actorName?: string; title?: string } = {}) => ({
  pageProps: {
    movie: {
      adultVideoId: "ZAKE-020",
      title: overrides.title ?? "AVWikiDB Sample Title",
      imageL: "https://pics.dmm.co.jp/digital/video/zake00020/zake00020pl.jpg",
      dateOfPublication: "2026-04-03",
      summary: "Generated fallback summary",
      actor: [
        {
          actor: {
            name: overrides.actorName ?? "天美めあ",
          },
        },
      ],
      maker: {
        name: "FALENO TUBE",
      },
      label: {
        name: "FALENO",
      },
      series: {
        name: "Sample Series",
      },
      genre: [
        {
          genre: {
            name: "単体作品",
          },
        },
      ],
    },
    dmmData: {
      product_id: "ZAKE-020",
      date: "2026-04-03 10:00:00",
      volume: "125",
      imageURL: {
        small: "https://pics.dmm.co.jp/digital/video/zake00020/zake00020ps.jpg",
        large: "https://pics.dmm.co.jp/digital/video/zake00020/zake00020pl.jpg",
      },
      sampleImageURL: {
        sample_l: {
          image: [
            "https://pics.dmm.co.jp/digital/video/zake00020/zake00020jp-1.jpg",
            "https://pics.dmm.co.jp/digital/video/zake00020/zake00020jp-2.jpg",
          ],
        },
      },
      sampleMovieURL: {
        size_720_480: "https://cc3001.dmm.co.jp/litevideo/freepv/z/zak/zake00020/zake00020_dmb_w.mp4",
      },
      iteminfo: {
        description: "Official plot from FANZA",
        director: [
          {
            name: "Director A",
          },
        ],
      },
    },
  },
});

describe("AvwikidbCrawler", () => {
  it("uses document headers for the home page and JSON headers for Next.js data", () => {
    const config = AvwikidbCrawler.siteRequestConfigs?.[0];
    if (!config || typeof config.headers !== "function") {
      throw new Error("Expected AVWikiDB to expose functional request headers");
    }

    const homeHeaders = new Headers(config.headers(new URL("https://avwikidb.com/")));
    const dataHeaders = new Headers(
      config.headers(new URL("https://avwikidb.com/_next/data/test-build/work/ZAKE-020.json")),
    );

    expect(homeHeaders.get("accept")).toContain("text/html");
    expect(homeHeaders.get("sec-fetch-dest")).toBe("document");
    expect(dataHeaders.get("accept")).toContain("application/json");
    expect(dataHeaders.get("sec-fetch-dest")).toBe("empty");
  });

  it("reads Next.js data JSON and maps work metadata", async () => {
    const buildId = "test-build";
    const networkClient = new FixtureNetworkClient(
      new Map<string, unknown>([
        ["https://avwikidb.com/", createHomeHtml(buildId)],
        [`https://avwikidb.com/_next/data/${buildId}/work/ZAKE-020.json`, createWorkPayload()],
      ]),
    );
    const crawler = new AvwikidbCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "zake-020",
      site: Website.AVWIKIDB,
      options: {},
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }

    expect(response.result.data).toMatchObject({
      website: Website.AVWIKIDB,
      number: "ZAKE-020",
      title: "AVWikiDB Sample Title",
      actors: ["天美めあ"],
      genres: ["単体作品"],
      studio: "FALENO TUBE",
      publisher: "FALENO",
      series: "Sample Series",
      director: "Director A",
      plot: "Official plot from FANZA",
      release_date: "2026-04-03",
      durationSeconds: 7_500,
      thumb_url: "https://pics.dmm.co.jp/digital/video/zake00020/zake00020pl.jpg",
      poster_url: "https://pics.dmm.co.jp/digital/video/zake00020/zake00020ps.jpg",
      trailer_url: "https://cc3001.dmm.co.jp/litevideo/freepv/z/zak/zake00020/zake00020_dmb_w.mp4",
    });
    expect(response.result.data.scene_images).toEqual([
      "https://pics.dmm.co.jp/digital/video/zake00020/zake00020jp-1.jpg",
      "https://pics.dmm.co.jp/digital/video/zake00020/zake00020jp-2.jpg",
    ]);
  });

  it("strips actor names appended to the end of AVWikiDB titles", async () => {
    const buildId = "test-build";
    const networkClient = new FixtureNetworkClient(
      new Map<string, unknown>([
        ["https://avwikidb.com/", createHomeHtml(buildId)],
        [
          `https://avwikidb.com/_next/data/${buildId}/work/ZAKE-020.json`,
          createWorkPayload({ title: "AVWikiDB Sample Title 天美めあ" }),
        ],
      ]),
    );
    const crawler = new AvwikidbCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "ZAKE-020",
      site: Website.AVWIKIDB,
      options: {},
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }

    expect(response.result.data.title).toBe("AVWikiDB Sample Title");
  });

  it("keeps actor names that are not separated trailing title suffixes", async () => {
    const buildId = "test-build";
    const networkClient = new FixtureNetworkClient(
      new Map<string, unknown>([
        ["https://avwikidb.com/", createHomeHtml(buildId)],
        [
          `https://avwikidb.com/_next/data/${buildId}/work/ZAKE-020.json`,
          createWorkPayload({ title: "AVWikiDB Sample Title天美めあ" }),
        ],
      ]),
    );
    const crawler = new AvwikidbCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "ZAKE-020",
      site: Website.AVWIKIDB,
      options: {},
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }

    expect(response.result.data.title).toBe("AVWikiDB Sample Title天美めあ");
  });

  it("keeps titles with actor names before trailing subtitle text", async () => {
    const cases = [
      {
        actorName: "岬ひかり",
        title:
          "メインタイトル:密室撮影会 岬ひかりサブタイトル:透き通る肢体、震えるVライン。 ―2人きりのいけない接写記録―",
      },
      {
        actorName: "泉美りな",
        title: "美脚長身スレンダー美人オトコの娘 泉美りな エッチが好き過ぎてAVデビューしちゃいました！！",
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const buildId = `test-build-${index}`;
      const networkClient = new FixtureNetworkClient(
        new Map<string, unknown>([
          ["https://avwikidb.com/", createHomeHtml(buildId)],
          [`https://avwikidb.com/_next/data/${buildId}/work/ZAKE-020.json`, createWorkPayload(testCase)],
        ]),
      );
      const crawler = new AvwikidbCrawler(withGateway(networkClient));

      const response = await crawler.crawl({
        number: "ZAKE-020",
        site: Website.AVWIKIDB,
        options: {},
      });

      expect(response.result.success).toBe(true);
      if (!response.result.success) {
        throw new Error(response.result.error);
      }

      expect(response.result.data.title).toBe(testCase.title);
    }
  });

  it("classifies missing Next.js build metadata as a parse error", async () => {
    const networkClient = new FixtureNetworkClient(new Map<string, unknown>([["https://avwikidb.com/", "<html />"]]));
    const crawler = new AvwikidbCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "ABF-075",
      site: Website.AVWIKIDB,
      options: {},
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("Expected AVWikiDB crawl to fail");
    }

    expect(response.result.failureReason).toBe("parse_error");
    expect(response.result.error).toContain("metadata build id missing");
  });
});
