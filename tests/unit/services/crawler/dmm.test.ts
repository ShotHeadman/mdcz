import { DmmCrawler } from "@main/services/crawler/sites/dmm";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("DmmCrawler", () => {
  it("parses supported DMM detail pages and keeps native DMM image URLs", async () => {
    const cases = [
      {
        number: "SSIS-497",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=ssis00497/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00497/",
        searchHtml: (detailUrl: string) => `
          <html><body>
            <script>
              const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};
            </script>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <h1><span>Sample DMM Digital Title</span></h1>
            <table>
              <tr><th>出演者</th><td><a>Actor A</a></td></tr>
              <tr><th>ジャンル</th><td><a>Tag A</a><a>Tag B</a></td></tr>
              <tr><th>メーカー</th><td><a>Studio A</a></td></tr>
              <tr><th>レーベル</th><td><a>Publisher A</a></td></tr>
              <tr><th>シリーズ</th><td><a>Series A</a></td></tr>
              <tr><th>監督</th><td><a>Director A</a></td></tr>
              <tr><th>配信開始日</th><td><span>2024/04/01</span></td></tr>
              <tr><th>収録時間</th><td><span>120分</span></td></tr>
            </table>
            <script type="application/ld+json">
            {
              "name": "Sample DMM Digital Title",
              "description": "Plot from json-ld",
              "image": [
                "https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497pl.jpg",
                "https://img.example.com/1.jpg",
                "https://img.example.com/2.jpg",
                "https://img.example.com/3.jpg"
              ],
              "brand": {"name": "Studio A"},
              "subjectOf": {
                "genre": ["Tag A", "Tag B"],
                "uploadDate": "2024-04-01",
                "contentUrl": "https://cdn.example.com/trailer.mp4",
                "actor": [{"name": "Actor A"}]
              },
              "aggregateRating": {"ratingValue": 4.2}
            }
            </script>
          </body></html>
        `,
        assert: (response: Awaited<ReturnType<DmmCrawler["crawl"]>>, networkClient: FixtureNetworkClient) => {
          if (!response.result.success) {
            throw new Error("expected success");
          }
          const data = response.result.data;
          expect(data.website).toBe(Website.DMM);
          expect(data.number).toBe("SSIS-497");
          expect(data.title).toBe("Sample DMM Digital Title");
          expect(data.plot).toBe("Plot from json-ld");
          expect(data.release_date).toBe("2024-04-01");
          expect(data.actors).toEqual(["Actor A"]);
          expect(data.genres).toEqual(["Tag A", "Tag B"]);
          expect(data.studio).toBe("Studio A");
          expect(data.publisher).toBe("Publisher A");
          expect(data.series).toBe("Series A");
          expect(data.director).toBe("Director A");
          expect(data.thumb_url).toBe("https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497pl.jpg");
          expect(data.poster_url).toBe("https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497ps.jpg");
          expect(data.trailer_url).toBe("https://cdn.example.com/trailer.mp4");
          expect(data.scene_images).toEqual([
            "https://img.example.com/1.jpg",
            "https://img.example.com/2.jpg",
            "https://img.example.com/3.jpg",
          ]);
          const dmmSearchRequest = networkClient.requests.find(
            (request) => request.url === "https://www.dmm.co.jp/search/=/searchstr=ssis00497/sort=ranking/",
          );
          expect(dmmSearchRequest?.headers.get("accept-language")).toBe("ja-JP,ja;q=0.9");
          expect(networkClient.requests.some((request) => request.url.includes("awsimgsrc.dmm.co.jp"))).toBe(false);
        },
      },
      {
        number: "ACPDP-1102",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=acpdp01102/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=acpdp01102/",
        searchHtml: (detailUrl: string) => `
          <html><body>
            <script>
              const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};
            </script>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <h1><span>Genre Merge Test</span></h1>
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
              "subjectOf": {
                "genre": ["Tag 1", "Tag 2"]
              }
            }
            </script>
          </body></html>
        `,
        assert: (response: Awaited<ReturnType<DmmCrawler["crawl"]>>) => {
          if (!response.result.success) {
            throw new Error("expected success");
          }

          expect(response.result.data.genres).toEqual([
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
            "Tag11",
            "Tag12",
            "Tag13",
          ]);
        },
      },
      {
        number: "SSIS-027",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=ssis00027/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00027/",
        searchHtml: (detailUrl: string) => `
          <html><body>
            <script>
              const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};
            </script>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <h1><span>AWS Optimization Test</span></h1>
            <meta property="og:image" content="https://pics.dmm.co.jp/digital/video/ssis00027/ssis00027ps.jpg" />
            <table>
              <tr><th>出演者</th><td><a>Actor AWS</a></td></tr>
              <tr><th>配信開始日</th><td><span>2024/03/15</span></td></tr>
            </table>
          </body></html>
        `,
        assert: (response: Awaited<ReturnType<DmmCrawler["crawl"]>>, networkClient: FixtureNetworkClient) => {
          if (!response.result.success) {
            throw new Error("expected success");
          }
          expect(response.result.data.title).toBe("AWS Optimization Test");
          expect(response.result.data.thumb_url).toBe("https://pics.dmm.co.jp/digital/video/ssis00027/ssis00027pl.jpg");
          expect(response.result.data.poster_url).toBe(
            "https://pics.dmm.co.jp/digital/video/ssis00027/ssis00027ps.jpg",
          );
          expect(networkClient.requests.some((request) => request.url.includes("awsimgsrc.dmm.co.jp"))).toBe(false);
        },
      },
    ];

    for (const { number, searchUrl, detailUrl, searchHtml, detailHtml, assert } of cases) {
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
        number: "SSNI-103",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=ssni00103/sort=ranking/",
        detailUrl: "https://tv.dmm.co.jp/list/?content=ssni00103&i3_ref=search&i3_ord=1",
        searchHtml: (detailUrl: string) => `
          <html><body>
            <script>
              const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/").replaceAll("&", "\\u0026")}"};
            </script>
          </body></html>
        `,
        detailHtml: "<html><body>tv detail</body></html>",
        expectedError: undefined,
      },
      {
        number: "DLDSS-463",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=dldss00463/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=dldss00463/",
        searchHtml: (detailUrl: string) => `
          <html><body>
            <script>
              const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};
            </script>
          </body></html>
        `,
        detailHtml: `
          <html>
            <head>
              <title>このページはお住まいの地域からご利用になれません。 - FANZA</title>
            </head>
            <body>
              <p>このサービスはお住まいの地域からはご利用になれません。</p>
            </body>
          </html>
        `,
        expectedError: "DMM: region blocked",
      },
      {
        number: "DLDSS-463",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=dldss00463/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=dldss00463/",
        searchHtml: (detailUrl: string) => `
          <html><body>
            <script>
              const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};
            </script>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <script>self.__next_f.push([1,"shell"])</script>
            <script src="/_next/static/chunks/main.js"></script>
          </body></html>
        `,
        expectedError: "DMM: unrendered shell",
      },
    ];

    for (const { number, searchUrl, detailUrl, searchHtml, detailHtml, expectedError } of cases) {
      const fixtures = new Map<string, unknown>([
        [searchUrl, searchHtml(detailUrl)],
        [detailUrl, detailHtml],
      ]);
      const crawler = new DmmCrawler(withGateway(new FixtureNetworkClient(fixtures)));

      const response = await crawler.crawl({
        number,
        site: Website.DMM,
      });

      expect(response.result.success).toBe(false);
      if (response.result.success) {
        throw new Error("expected failure");
      }
      if (expectedError) {
        expect(response.result.error).toBe(expectedError);
      }
    }
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
      [
        detailUrl,
        `
          <html><body>
            <h1><span>KNBM Search Recovery</span></h1>
            <table>
              <tr><th>鍑烘紨鑰?/th><td><a>Actor Recovery</a></td></tr>
              <tr><th>銈搞儯銉炽儷</th><td><a>Tag Recovery</a></td></tr>
            </table>
          </body></html>
        `,
      ],
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
});
