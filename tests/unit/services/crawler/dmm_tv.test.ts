import { DmmTvCrawler } from "@main/services/crawler/sites/dmm/dmm_tv";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("DmmTvCrawler", () => {
  it("prefers 1-prefixed detail id for non-prefixed numbers", async () => {
    const number = "STARS-804";
    const preferredDetailUrl = "https://video.dmm.co.jp/av/content/?id=1stars00804";

    const fixtures = new Map<string, unknown>([
      [
        preferredDetailUrl,
        `<html><body>
          <h1 id="title"><span>DMM TV STARS Preferred</span></h1>
          <table>
            <tr><th>出演者</th><td><a>Actor Preferred</a></td></tr>
            <tr><th>ジャンル</th><td><a>Tag Preferred</a></td></tr>
          </table>
        </body></html>`,
      ],
    ]);

    const networkClient = new FixtureNetworkClient(fixtures);
    const crawler = new DmmTvCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number,
      site: Website.DMM_TV,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    const detailRequests = networkClient.requests
      .map((request) => request.url)
      .filter((url) => url.includes("video.dmm.co.jp/av/content/?id="));
    expect(detailRequests[0]).toBe(preferredDetailUrl);
  });

  it("normalizes leading-digit prefixes and falls back to padded video id", async () => {
    const number = "1STARS-804";
    const detailUrl = "https://video.dmm.co.jp/av/content/?id=1stars00804";

    const fixtures = new Map<string, unknown>([
      [
        detailUrl,
        `<html><body>
          <h1 id="title"><span>DMM TV STARS</span></h1>
          <table>
            <tr><th>出演者</th><td><a>Actor STARS</a></td></tr>
            <tr><th>ジャンル</th><td><a>Tag STARS</a></td></tr>
          </table>
        </body></html>`,
      ],
    ]);

    const networkClient = new FixtureNetworkClient(fixtures);

    const crawler = new DmmTvCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number,
      site: Website.DMM_TV,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.title).toBe("DMM TV STARS");
    expect(response.result.data.actors).toEqual(["Actor STARS"]);
    expect(response.result.data.genres).toEqual(["Tag STARS"]);

    const dmmTvDetailRequest = networkClient.requests.find((request) => request.url === detailUrl);
    expect(dmmTvDetailRequest?.headers.get("accept-language")).toBe("ja-JP,ja;q=0.9");
  });

  it("classifies login-wall detail pages", async () => {
    const number = "DLDSS-463";
    const detailUrl = "https://video.dmm.co.jp/av/content/?id=1dldss00463";

    const fixtures = new Map<string, unknown>([
      [
        detailUrl,
        `<html>
          <head>
            <title>FANZA ログイン</title>
          </head>
          <body>
            <h1 id="title"><span>FANZA ログイン</span></h1>
            <form>
              <input name="login_id" />
              <input type="password" name="password" />
            </form>
          </body>
        </html>`,
      ],
    ]);

    const crawler = new DmmTvCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number,
      site: Website.DMM_TV,
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("expected failure");
    }

    expect(response.result.error).toBe("DMM_TV: login wall");
  });

  it("uses unified DMM video graphql endpoint before html fallback", async () => {
    const number = "STARS-804";
    const detailUrl = "https://video.dmm.co.jp/av/content/?id=1stars00804";

    const fixtures = new Map<string, unknown>([
      [detailUrl, `<html><body><script>self.__next_f.push([1,"shell"])</script></body></html>`],
      [
        "https://api.video.dmm.co.jp/graphql",
        {
          data: {
            ppvContent: {
              title: "Unified GraphQL STARS Title",
              makerContentId: "STARS-804",
              description: "Unified graphQL plot",
              makerReleasedAt: "2025-05-17T20:00:00Z",
              duration: 5400,
              sample2DMovie: {
                highestMovieUrl: "https://video.example.com/stars804.mp4",
              },
              sampleImages: [{ largeImageUrl: "https://cdn.example.com/sample1.jpg" }],
              packageImage: {
                largeUrl: "https://cdn.example.com/cover.jpg",
                mediumUrl: "https://cdn.example.com/poster.jpg",
              },
              actresses: [{ name: "Actor TV" }],
              directors: [{ name: "Director TV" }],
              maker: { name: "Studio TV" },
              label: { name: "Publisher TV" },
              genres: [{ name: "Tag TV" }],
            },
            reviewSummary: { average: 3.8 },
          },
        },
      ],
    ]);

    const crawler = new DmmTvCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number,
      site: Website.DMM_TV,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.title).toBe("Unified GraphQL STARS Title");
    expect(response.result.data.number).toBe("STARS-804");
    expect(response.result.data.durationSeconds).toBe(5400);
    expect(response.result.data.actors).toEqual(["Actor TV"]);
    expect(response.result.data.thumb_url).toBe("https://cdn.example.com/cover.jpg");
    expect(response.result.data.trailer_url).toBe("https://video.example.com/stars804.mp4");
  });
});
