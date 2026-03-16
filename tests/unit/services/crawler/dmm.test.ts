import { DmmCrawler } from "@main/services/crawler/sites/dmm";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("DmmCrawler", () => {
  it("parses digital detail with JSON-LD metadata", async () => {
    const number = "SSIS-497";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=ssis00497/sort=ranking/";
    const detailUrl = "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00497/";

    const searchHtml = `
      <html><body>
        <script>
          const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};
        </script>
      </body></html>
    `;

    const detailHtml = `
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
    `;

    const fixtures = new Map<string, unknown>([
      [searchUrl, searchHtml],
      [detailUrl, detailHtml],
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

    const data = response.result.data;
    expect(data.website).toBe(Website.DMM);
    expect(data.number).toBe(number);
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
    expect(data.sample_images).toEqual([
      "https://img.example.com/1.jpg",
      "https://img.example.com/2.jpg",
      "https://img.example.com/3.jpg",
    ]);

    const dmmSearchRequest = networkClient.requests.find((request) => request.url === searchUrl);
    expect(dmmSearchRequest?.headers.get("accept-language")).toBe("ja-JP,ja;q=0.9");
    expect(networkClient.requests.some((request) => request.url.includes("awsimgsrc.dmm.co.jp"))).toBe(false);
  });

  it("returns failure for tv.dmm detail pages after compatibility removal", async () => {
    const number = "SSNI-103";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=ssni00103/sort=ranking/";
    const detailUrl = "https://tv.dmm.co.jp/list/?content=ssni00103&i3_ref=search&i3_ord=1";

    const searchHtml = `
      <html><body>
        <script>
          const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/").replaceAll("&", "\\u0026")}"};
        </script>
      </body></html>
    `;

    const fixtures = new Map<string, unknown>([
      [searchUrl, searchHtml],
      [detailUrl, "<html><body>tv detail</body></html>"],
    ]);

    const crawler = new DmmCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number,
      site: Website.DMM,
    });

    expect(response.result.success).toBe(false);
  });

  it("classifies region-blocked detail page with explicit error", async () => {
    const number = "DLDSS-463";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=dldss00463/sort=ranking/";
    const detailUrl = "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=dldss00463/";

    const searchHtml = `
      <html><body>
        <script>
          const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};
        </script>
      </body></html>
    `;

    const detailHtml = `
      <html>
        <head>
          <title>このページはお住まいの地域からご利用になれません。 - FANZA</title>
        </head>
        <body>
          <p>このサービスはお住まいの地域からはご利用になれません。</p>
        </body>
      </html>
    `;

    const fixtures = new Map<string, unknown>([
      [searchUrl, searchHtml],
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

    expect(response.result.error).toBe("DMM: region blocked");
  });

  it("treats unrendered digital shell as failure without synthetic detail fallback", async () => {
    const number = "DLDSS-463";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=dldss00463/sort=ranking/";
    const digitalDetailUrl = "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=dldss00463/";

    const searchHtml = `
      <html><body>
        <script>
          const item = {"detailUrl":"${digitalDetailUrl.replaceAll("/", "\\/")}"};
        </script>
      </body></html>
    `;

    const shellHtml = `
      <html><body>
        <script>self.__next_f.push([1,"shell"])</script>
        <script src="/_next/static/chunks/main.js"></script>
      </body></html>
    `;

    const fixtures = new Map<string, unknown>([
      [searchUrl, searchHtml],
      [digitalDetailUrl, shellHtml],
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
    expect(response.result.error).toBe("DMM: unrendered shell");
  });

  it("keeps original DMM image urls in crawler output", async () => {
    const number = "SSIS-027";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=ssis00027/sort=ranking/";
    const detailUrl = "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00027/";

    const searchHtml = `
      <html><body>
        <script>
          const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};
        </script>
      </body></html>
    `;

    const detailHtml = `
      <html><body>
        <h1><span>AWS Optimization Test</span></h1>
        <meta property="og:image" content="https://pics.dmm.co.jp/digital/video/ssis00027/ssis00027ps.jpg" />
        <table>
          <tr><th>出演者</th><td><a>Actor AWS</a></td></tr>
          <tr><th>配信開始日</th><td><span>2024/03/15</span></td></tr>
        </table>
      </body></html>
    `;

    const networkClient = new FixtureNetworkClient(
      new Map<string, unknown>([
        [searchUrl, searchHtml],
        [detailUrl, detailHtml],
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

    const data = response.result.data;
    expect(data.title).toBe("AWS Optimization Test");
    expect(data.thumb_url).toBe("https://pics.dmm.co.jp/digital/video/ssis00027/ssis00027pl.jpg");
    expect(data.poster_url).toBe("https://pics.dmm.co.jp/digital/video/ssis00027/ssis00027ps.jpg");
    expect(networkClient.requests.some((request) => request.url.includes("awsimgsrc.dmm.co.jp"))).toBe(false);
  });

  it("does not hard-fail when legacy dmm tv graphql returns miss after unified miss", async () => {
    const number = "STARS-804";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=stars00804/sort=ranking/";
    const detailUrl = "https://tv.dmm.com/vod/detail/?seasonId=12345";

    const searchHtml = `
      <html><body>
        <script>
          const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};
        </script>
      </body></html>
    `;

    const fixtures = new Map<string, unknown>([
      [searchUrl, searchHtml],
      [detailUrl, "<html><body>dmm tv detail without metadata</body></html>"],
      ["https://api.video.dmm.co.jp/graphql", { data: {} }],
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

    expect(response.result.error).not.toContain("Missing fixture for https://api.tv.dmm.com/graphql");
  });
});
