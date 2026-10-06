import { DmmCrawler } from "@mdcz/runtime/crawler/sites/dmm";
import { parseDmmVideoData } from "@mdcz/runtime/crawler/sites/dmm/dmmVideo";
import { SiteError } from "@mdcz/runtime/network";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

type DmmResponse = Awaited<ReturnType<DmmCrawler["crawl"]>>;

const searchHtml = (detailUrl: string): string => `
  <html><body><script>const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};</script></body></html>
`;

const successfulData = (response: DmmResponse) => {
  expect(response.result.success).toBe(true);
  if (!response.result.success) throw new Error("expected success");
  return response.result.data;
};

const GENRE_MERGE_HTML = `<html><body>
  <h1><span>Genre Merge Test</span></h1>
  <table><tr><th>品番</th><td>ACPDP-1102</td></tr></table>
  <table>
    <tr><th>ジャンル</th><td>
      <a>Tag 1</a><a>サンプル動画</a><a>Tag 2</a><a>Tag 3</a><a>Tag 4</a><a>Tag 5</a>
      <a>Tag 6</a><a>Tag 7</a><a>Tag 8</a><a>Tag 9</a><a>Tag 10</a>
    </td></tr>
    <tr><th>関連タグ</th><td>
      <ul>
        <li><a>#Tag11 #Tag12</a></li>
        <li><a>#Tag12 #Tag13</a></li>
      </ul>
    </td></tr>
    <tr><th>メーカー</th><td><a>Studio Merge</a></td></tr>
  </table>
  <script type="application/ld+json">
  {
    "name": "Genre Merge Test",
    "image": ["https://pics.dmm.co.jp/digital/video/acpdp01102/acpdp01102pl.jpg"],
    "subjectOf": {"genre": ["Tag 1", "Tag 2"]}
  }
  </script>
</body></html>`;

const NOISE_ISOLATION_HTML = `<html><body>
  <h1><span>DMM Noise Isolation</span></h1>
  <table><tr><th>品番</th><td>MNGS-051</td></tr></table>
  <div>
    <span>ジャンル</span>
    <a>レビューを見る</a>
    <a>次へ</a>
    <a>単月レンタルに追加</a>
  </div>
  <table>
    <tr><th>出演者</th><td><a>彩月七緒</a></td></tr>
    <tr><th>ジャンル</th><td><a>巨乳</a><a>中出し</a></td></tr>
    <tr><th>メーカー</th><td><a>MOODYZ</a></td></tr>
    <tr><th>レーベル</th><td><a>MOODYZ ニュージーニアス</a></td></tr>
    <tr><th>配信開始日</th><td><span>2026/05/04</span></td></tr>
  </table>
  <script type="application/ld+json">
  {
    "name": "DMM Noise Isolation",
    "image": ["https://pics.dmm.co.jp/digital/video/mngs00051/mngs00051pl.jpg"],
    "subjectOf": {"genre": ["巨乳", "中出し"]}
  }
  </script>
</body></html>`;

const AWS_OPTIMIZATION_HTML = `<html><body>
  <h1><span>AWS Optimization Test</span></h1>
  <table><tr><th>品番</th><td>SSIS-027</td></tr></table>
  <meta property="og:image" content="https://pics.dmm.co.jp/digital/video/ssis00027/ssis00027ps.jpg">
  <table>
    <tr><th>出演者</th><td><a>Actor AWS</a></td></tr>
    <tr><th>配信開始日</th><td><span>2024/03/15</span></td></tr>
  </table>
</body></html>`;

const REGION_BLOCKED_HTML = `<html>
  <head><title>このページはお住まいの地域からご利用になれません。 - FANZA</title></head>
  <body><p>このサービスはお住まいの地域からはご利用になれません。</p></body>
</html>`;

const UNRENDERED_SHELL_HTML = `<html><body>
  <script>self.__next_f.push([1,"shell"])</script>
  <script src="/_next/static/chunks/main.js"></script>
</body></html>`;

const DIRECT_DETAIL_HTML = `<html><body>
  <h1><span>Direct Detail Title</span></h1>
  <table><tr><th>品番</th><td>SSIS-497</td></tr></table>
  <meta property="og:image" content="https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497ps.jpg">
</body></html>`;

const KNBM_SEARCH_RECOVERY_HTML = `<html><body>
  <h1><span>KNBM Search Recovery</span></h1>
  <table><tr><th>品番</th><td>KNBM-007</td></tr></table>
  <table>
    <tr><th>出演者</th><td><a>Actor Recovery</a></td></tr>
    <tr><th>ジャンル</th><td><a>Tag Recovery</a></td></tr>
  </table>
</body></html>`;

describe("DmmCrawler", () => {
  it("parses supported DMM detail pages and keeps native DMM image URLs", async () => {
    const cases = [
      {
        number: "ACPDP-1102",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=acpdp01102/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=acpdp01102/",
        detailHtml: GENRE_MERGE_HTML,
        assert: (response: DmmResponse) => {
          expect(successfulData(response).genres).toEqual([
            "Tag 1",
            "Tag 2",
            "Tag 3",
            "Tag 4",
            "Tag 5",
            "Tag 6",
            "Tag 7",
            "Tag 8",
            "Tag 9",
            "Tag 10",
          ]);
        },
      },
      {
        number: "MNGS-051",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=mngs00051/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=mngs00051/",
        detailHtml: NOISE_ISOLATION_HTML,
        assert: (response: DmmResponse) => {
          const data = successfulData(response);
          expect(data.genres).toEqual(["巨乳", "中出し"]);
          expect(data.genres).not.toContain("レビューを見る");
          expect(data.genres).not.toContain("次へ");
          expect(data.publisher).toBe("MOODYZ ニュージーニアス");
        },
      },
      {
        number: "SSIS-027",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=ssis00027/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00027/",
        detailHtml: AWS_OPTIMIZATION_HTML,
        assert: (response: DmmResponse, networkClient: FixtureNetworkClient) => {
          const data = successfulData(response);
          expect(data.title).toBe("AWS Optimization Test");
          expect(data.thumb_url).toBe("https://pics.dmm.co.jp/digital/video/ssis00027/ssis00027pl.jpg");
          expect(data.poster_url).toBe("https://pics.dmm.co.jp/digital/video/ssis00027/ssis00027ps.jpg");
          expect(networkClient.requests.some((request) => request.url.includes("awsimgsrc.dmm.co.jp"))).toBe(false);
        },
      },
    ];

    for (const { number, searchUrl, detailUrl, detailHtml, assert } of cases) {
      const fixtures = new Map<string, unknown>([
        [searchUrl, searchHtml(detailUrl)],
        [detailUrl, detailHtml],
      ]);
      const networkClient = new FixtureNetworkClient(fixtures);
      const crawler = new DmmCrawler(withGateway(networkClient));

      const response = await crawler.crawl({
        number,
        site: Website.DMM,
      });

      expect(response.result.success).toBe(true);
      assert(response, networkClient);
    }
  });

  it("classifies incompatible or blocked DMM detail pages as failures", async () => {
    const cases = [
      {
        number: "DLDSS-463",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=dldss00463/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=dldss00463/",
        detailHtml: REGION_BLOCKED_HTML,
        expected: {
          reason: "region_blocked",
          error: "region_blocked page served for https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=dldss00463/",
        },
      },
      {
        number: "DLDSS-463",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=dldss00463/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=dldss00463/",
        detailHtml: UNRENDERED_SHELL_HTML,
        expected: { reason: "empty_shell", error: "DMM: unrendered shell" },
      },
    ];

    for (const { number, searchUrl, detailUrl, detailHtml, expected } of cases) {
      const fixtures = new Map<string, unknown>([
        [searchUrl, searchHtml(detailUrl)],
        [detailUrl, detailHtml],
      ]);
      const crawler = new DmmCrawler(withGateway(new FixtureNetworkClient(fixtures)));

      const response = await crawler.crawl({
        number,
        site: Website.DMM,
      });

      expect(response.result).toMatchObject({ success: false, ...expected });
    }
  });

  it("uses manual detail URLs directly without running search", async () => {
    const detailUrl = "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00497/";
    const networkClient = new FixtureNetworkClient(new Map<string, unknown>([[detailUrl, DIRECT_DETAIL_HTML]]));
    const crawler = new DmmCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "SSIS-497",
      site: Website.DMM,
      options: {
        detailUrl,
      },
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }
    expect(response.result.data.title).toBe("Direct Detail Title");
    expect(networkClient.requests.map((request) => request.url)).toEqual([detailUrl]);
  });

  it("routes tv.dmm.co.jp list search candidates through DMM Video GraphQL", async () => {
    for (const [makerReleasedAt, deliveryStartDate, expected] of [
      ["2026-07-27T15:00:00Z", "2026-07-23T15:00:00Z", "2026-07-28"],
      [undefined, "2026-07-23T15:00:00Z", "2026-07-24"],
      ["2026-07-27T14:59:59Z", undefined, "2026-07-27"],
      ["2026-07-28T00:00:00+09:00", undefined, "2026-07-28"],
      [undefined, undefined, undefined],
    ]) {
      expect(
        parseDmmVideoData({
          ppvContent: {
            title: "Title",
            makerReleasedAt,
            deliveryStartDate,
            genres: [{ name: "メイド" }, { name: "メイド" }],
            relatedTags: [{ name: "見えた" }, { tags: [{ name: "彼女" }] }],
          },
        }),
      ).toMatchObject({ release_date: expected, genres: ["メイド"] });
    }
    const number = "SSNI-103";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=ssni00103/sort=ranking/";
    const tvDetailUrl = "https://tv.dmm.co.jp/list/?content=ssni00103&i3_ref=search&i3_ord=1";
    const graphqlUrl = "https://api.video.dmm.co.jp/graphql";
    const searchHtml = `
      <html><body>
        <script>
          const item = {"detailUrl":"${tvDetailUrl.replaceAll("/", "\\/").replaceAll("&", "\\u0026")}"};
        </script>
      </body></html>
    `;
    const networkClient = new FixtureNetworkClient(
      new Map<string, unknown>([
        [searchUrl, searchHtml],
        [
          graphqlUrl,
          {
            data: {
              ppvContent: {
                title: "DMM Video From TV List",
                makerContentId: "SSNI-103",
                description: "Recovered from tv.dmm.co.jp list content",
                makerReleasedAt: "2024-01-19T00:00:00Z",
                duration: 7200,
                packageImage: {
                  largeUrl: "https://cdn.example.com/ssni-cover.jpg",
                  mediumUrl: "https://cdn.example.com/ssni-poster.jpg",
                },
              },
              reviewSummary: { average: 4.1 },
            },
          },
        ],
      ]),
    );
    const crawler = new DmmCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number,
      site: Website.DMM,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.website).toBe(Website.DMM);
    expect(response.result.data.title).toBe("DMM Video From TV List");
    expect(response.result.data.number).toBe("SSNI-103");
    expect(response.result.data.plot).toBe("Recovered from tv.dmm.co.jp list content");
    expect(networkClient.requests.map((request) => request.url)).toEqual([searchUrl]);
  });

  it("rejects search summaries when DMM Video supplies no detail identity", async () => {
    const number = "SSIS-497";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=ssis00497/sort=ranking/";
    const tvDetailUrl = "https://tv.dmm.co.jp/list/?content=ssis00497&i3_ref=search&i3_ord=1";
    const graphqlUrl = "https://api.video.dmm.co.jp/graphql";
    const title = "Matched DMM Search Fallback Title";
    const posterUrl = "https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497ps.jpg";
    const searchHtml = `
      <html><body>
        <script>
          self.__next_f.push([1,"{\\"content_id\\":\\"ssis00497\\",\\"title\\":\\"${title}\\",\\"detail_url\\":\\"${tvDetailUrl.replaceAll("&", "\\u0026")}\\",\\"thumbnail_image_url\\":\\"${posterUrl}\\"}"])
        </script>
        <p>出演者：Search Actor</p>
      </body></html>
    `;
    const networkClient = new FixtureNetworkClient(
      new Map<string, unknown>([
        [searchUrl, searchHtml],
        [graphqlUrl, { data: { ppvContent: null } }],
      ]),
    );
    const crawler = new DmmCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number,
      site: Website.DMM,
    });

    expect(response.result).toMatchObject({ success: false, reason: "parse_error" });
    expect(networkClient.requests.map((request) => request.url)).toEqual([searchUrl]);
  });

  it("does not let matched search metadata mask a DMM region block", async () => {
    const number = "SSIS-497";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=ssis00497/sort=ranking/";
    const detailUrl = "https://tv.dmm.co.jp/list/?content=ssis00497";
    const graphqlUrl = "https://api.video.dmm.co.jp/graphql";
    const searchHtml = `
      <html><body>
        <script>
          const item = {"contentId":"ssis00497","name":"Candidate Title","detailUrl":"${detailUrl}"};
        </script>
        <p>このサービスはお住まいの地域からはご利用になれません。</p>
      </body></html>
    `;
    const crawler = new DmmCrawler(
      withGateway(
        new FixtureNetworkClient(
          new Map<string, unknown>([
            [searchUrl, searchHtml],
            [graphqlUrl, { data: { ppvContent: null } }],
          ]),
        ),
      ),
    );

    const response = await crawler.crawl({
      number,
      site: Website.DMM,
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("expected failure");
    }
    expect(response.result.reason).toBe("region_blocked");
    expect(response.result.error).toBe(`region_blocked page served for ${searchUrl}`);
  });

  it("falls back to additional search keywords and parses direct detail anchors", async () => {
    const number = "KNBM-007";
    const primarySearchUrl = "https://www.dmm.co.jp/search/=/searchstr=knbm00007/sort=ranking/";
    const compactSearchUrl = "https://www.dmm.co.jp/search/=/searchstr=knbm007/sort=ranking/";
    const hyphenatedSearchUrl = "https://www.dmm.co.jp/search/=/searchstr=knbm-007/sort=ranking/";
    const detailUrl = "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=knbm007/";

    const fixtures = new Map<string, unknown>([
      [primarySearchUrl, "<html><body><div>no match</div></body></html>"],
      [compactSearchUrl, "<html><body><div>still no match</div></body></html>"],
      [hyphenatedSearchUrl, `<html><body><a href="${detailUrl}">KNBM-007 Detail</a></body></html>`],
      [detailUrl, KNBM_SEARCH_RECOVERY_HTML],
    ]);

    const networkClient = new FixtureNetworkClient(fixtures);
    const crawler = new DmmCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number,
      site: Website.DMM,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.title).toBe("KNBM Search Recovery");
    expect(networkClient.requests.map((request) => request.url)).toContain(hyphenatedSearchUrl);
  });

  it("walks the remaining search candidates when the first detail page fails identity verification", async () => {
    const number = "SNOS-301";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=snos00301/sort=ranking/";
    const firstUrl = "https://www.dmm.co.jp/mono/dvd/-/detail/=/cid=snos301/";
    const secondUrl = "https://www.dmm.co.jp/mono/dvd/-/detail/=/cid=tksnos301/";
    const search = `<html><body>
      <script>const item = {"detailUrl":"${firstUrl.replaceAll("/", "\\/")}"};</script>
      <script>const item2 = {"detailUrl":"${secondUrl.replaceAll("/", "\\/")}"};</script>
    </body></html>`;
    const detailHtml = (title: string, sku: string) => `
      <html><body>
        <h1><span>${title}</span></h1>
        <table><tr><th>品番</th><td>${sku}</td></tr></table>
      </body></html>`;

    const cases = [
      {
        pages: new Map<string, unknown>([
          [searchUrl, search],
          [firstUrl, detailHtml("Wrong Identity", "SNOS-302")],
          [secondUrl, detailHtml("Fallback Identity", "SNOS-301")],
        ]),
        expected: { success: true, data: { number, title: "Fallback Identity" } },
      },
      {
        pages: new Map<string, unknown>([
          [searchUrl, search],
          [firstUrl, detailHtml("Wrong Identity", "SNOS-302")],
          [secondUrl, detailHtml("Still Wrong", "SNOS-303")],
        ]),
        expected: { success: false, reason: "not_found" },
      },
      {
        pages: new Map<string, unknown>([
          [searchUrl, search],
          [firstUrl, detailHtml("Wrong Identity", "SNOS-302")],
          [secondUrl, new SiteError("rate_limited", "HTTP 429")],
        ]),
        expected: { success: false, reason: "rate_limited" },
      },
    ];

    for (const { pages, expected } of cases) {
      const networkClient = new FixtureNetworkClient(pages);
      const response = await new DmmCrawler(withGateway(networkClient)).crawl({ number, site: Website.DMM });
      expect(response.result).toMatchObject(expected);
      expect(networkClient.requests.map((request) => request.url)).toEqual([searchUrl, firstUrl, secondUrl]);
    }
  });
});
