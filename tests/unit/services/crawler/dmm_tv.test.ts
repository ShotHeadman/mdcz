import { DmmTvCrawler } from "@main/services/crawler/sites/dmm/dmm_tv";
import { NetworkClient } from "@main/services/network";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

class BodyAwareDmmTvNetworkClient extends NetworkClient {
  readonly requests: Array<{ url: string; body?: unknown }> = [];

  constructor(private readonly htmlFixtures: Map<string, string>) {
    super({});
  }

  override async getText(url: string): Promise<string> {
    this.requests.push({ url });
    const fixture = this.htmlFixtures.get(url);
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    return fixture;
  }

  override async postJson<TResponse>(url: string, payload: unknown): Promise<TResponse> {
    this.requests.push({ url, body: payload });
    if (url !== "https://api.video.dmm.co.jp/graphql") {
      throw new Error(`Missing fixture for ${url}`);
    }

    const operation = payload as {
      operationName?: string;
      variables?: Record<string, unknown>;
    };
    const operationName = operation.operationName;

    if (operationName === "ContentPageData") {
      const id = String(operation.variables?.id ?? "");
      if (id === "realknbm007") {
        return {
          data: {
            ppvContent: {
              title: "Resolved GraphQL KNBM Title",
              makerContentId: "KNBM-007",
              description: "Recovered through search",
              makerReleasedAt: "2025-05-18T00:00:00Z",
              duration: 3600,
              packageImage: {
                largeUrl: "https://cdn.example.com/knbm-cover.jpg",
                mediumUrl: "https://cdn.example.com/knbm-poster.jpg",
              },
              sampleImages: [{ largeImageUrl: "https://cdn.example.com/knbm-sample.jpg" }],
              actresses: [{ name: "Actor KNBM" }],
              genres: [{ name: "Tag KNBM" }],
            },
            reviewSummary: { average: 4.1 },
          },
        } as TResponse;
      }

      return { data: {} } as TResponse;
    }

    if (operationName === "AvSearch") {
      const queryWord = String(operation.variables?.queryWord ?? "");
      if (queryWord === "knbm-007") {
        return {
          data: {
            legacySearchPPV: {
              result: {
                contents: [{ id: "realknbm007", title: "KNBM-007 Search Hit" }],
              },
            },
          },
        } as TResponse;
      }

      if (queryWord === "zzzz-999") {
        return {
          data: {
            legacySearchPPV: {
              result: {
                contents: [{ id: "unrelated001", title: "Completely Different Title" }],
              },
            },
          },
        } as TResponse;
      }

      return {
        data: {
          legacySearchPPV: {
            result: {
              contents: [],
            },
          },
        },
      } as TResponse;
    }

    if (operationName === "AnimeSearch") {
      return {
        data: {
          legacySearchPPV: {
            result: {
              contents: [],
            },
          },
        },
      } as TResponse;
    }

    throw new Error(`Unexpected payload for ${url}`);
  }
}

describe("DmmTvCrawler", () => {
  it("resolves detail ids for prefixed and non-prefixed numbers", async () => {
    const cases = [
      {
        number: "STARS-804",
        detailUrl: "https://video.dmm.co.jp/av/content/?id=1stars00804",
        detailHtml: `
          <html><body>
            <h1 id="title"><span>DMM TV STARS Preferred</span></h1>
            <table>
              <tr><th>出演者</th><td><a>Actor Preferred</a></td></tr>
              <tr><th>ジャンル</th><td><a>Tag Preferred</a></td></tr>
            </table>
          </body></html>
        `,
        assert: (response: Awaited<ReturnType<DmmTvCrawler["crawl"]>>, networkClient: FixtureNetworkClient) => {
          if (!response.result.success) {
            throw new Error("expected success");
          }
          const detailRequests = networkClient.requests
            .map((request) => request.url)
            .filter((url) => url.includes("video.dmm.co.jp/av/content/?id="));
          expect(detailRequests[0]).toBe("https://video.dmm.co.jp/av/content/?id=1stars00804");
        },
      },
      {
        number: "1STARS-804",
        detailUrl: "https://video.dmm.co.jp/av/content/?id=1stars00804",
        detailHtml: `
          <html><body>
            <h1 id="title"><span>DMM TV STARS</span></h1>
            <table>
              <tr><th>出演者</th><td><a>Actor STARS</a></td></tr>
              <tr><th>ジャンル</th><td><a>Tag STARS</a></td></tr>
            </table>
          </body></html>
        `,
        assert: (response: Awaited<ReturnType<DmmTvCrawler["crawl"]>>, networkClient: FixtureNetworkClient) => {
          if (!response.result.success) {
            throw new Error("expected success");
          }
          expect(response.result.data.title).toBe("DMM TV STARS");
          expect(response.result.data.actors).toEqual(["Actor STARS"]);
          expect(response.result.data.genres).toEqual(["Tag STARS"]);
          const detailRequest = networkClient.requests.find(
            (request) => request.url === "https://video.dmm.co.jp/av/content/?id=1stars00804",
          );
          expect(detailRequest?.headers.get("accept-language")).toBe("ja-JP,ja;q=0.9");
        },
      },
      {
        number: "ACPDP-1102",
        detailUrl: "https://video.dmm.co.jp/anime/content/?id=1acpdp01102",
        detailHtml: `
          <html><body>
            <h1 id="title"><span>DMM TV ACPDP</span></h1>
            <table>
              <tr><th>出演者</th><td><a>Actor ACPDP</a></td></tr>
              <tr><th>ジャンル</th><td><a>Tag Anime</a><a>Tag Extra</a></td></tr>
            </table>
          </body></html>
        `,
        assert: (response: Awaited<ReturnType<DmmTvCrawler["crawl"]>>, networkClient: FixtureNetworkClient) => {
          if (!response.result.success) {
            throw new Error("expected success");
          }
          expect(response.result.data.title).toBe("DMM TV ACPDP");
          expect(response.result.data.genres).toEqual(["Tag Anime", "Tag Extra"]);
          expect(networkClient.requests.map((request) => request.url)).toContain(
            "https://video.dmm.co.jp/av/content/?id=1acpdp01102",
          );
          expect(networkClient.requests.map((request) => request.url)).toContain(
            "https://video.dmm.co.jp/anime/content/?id=1acpdp01102",
          );
        },
      },
    ];

    for (const { number, detailUrl, detailHtml, assert } of cases) {
      const networkClient = new FixtureNetworkClient(new Map<string, unknown>([[detailUrl, detailHtml]]));
      const crawler = new DmmTvCrawler(withGateway(networkClient));

      const response = await crawler.crawl({
        number,
        site: Website.DMM_TV,
      });

      expect(response.result.success).toBe(true);
      assert(response, networkClient);
    }
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
              relatedTags: [{ name: "Related TV" }, { tags: [{ name: "Tag TV" }, { name: "Extra TV" }] }],
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
    expect(response.result.data.genres).toEqual(["Tag TV", "Related TV", "Extra TV"]);
    expect(response.result.data.thumb_url).toBe("https://cdn.example.com/cover.jpg");
    expect(response.result.data.trailer_url).toBe("https://video.example.com/stars804.mp4");
  });

  it("searches GraphQL for a real content id when guessed ids miss", async () => {
    const guessedDetailUrl = "https://video.dmm.co.jp/av/content/?id=1knbm00007";
    const networkClient = new BodyAwareDmmTvNetworkClient(
      new Map<string, string>([
        [guessedDetailUrl, `<html><body><script>self.__next_f.push([1,"shell"])</script></body></html>`],
      ]),
    );
    const crawler = new DmmTvCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "KNBM-007",
      site: Website.DMM_TV,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.title).toBe("Resolved GraphQL KNBM Title");
    expect(response.result.data.number).toBe("KNBM-007");
    expect(response.result.data.genres).toEqual(["Tag KNBM"]);
    const payloads = networkClient.requests.filter((request) => request.url === "https://api.video.dmm.co.jp/graphql");
    expect(payloads.some((request) => (request.body as { operationName?: string })?.operationName === "AvSearch")).toBe(
      true,
    );
    expect(
      payloads.some(
        (request) =>
          (request.body as { operationName?: string; variables?: Record<string, unknown> })?.operationName ===
            "ContentPageData" &&
          String((request.body as { variables?: Record<string, unknown> })?.variables?.id ?? "") === "realknbm007",
      ),
    ).toBe(true);
  });

  it("does not accept a single GraphQL search result without an id or title match", async () => {
    const guessedDetailUrl = "https://video.dmm.co.jp/av/content/?id=1zzzz00999";
    const networkClient = new BodyAwareDmmTvNetworkClient(
      new Map<string, string>([
        [guessedDetailUrl, `<html><body><script>self.__next_f.push([1,"shell"])</script></body></html>`],
      ]),
    );
    const crawler = new DmmTvCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "ZZZZ-999",
      site: Website.DMM_TV,
    });

    expect(response.result.success).toBe(false);
    const requestedContentIds = networkClient.requests
      .filter((request) => request.url === "https://api.video.dmm.co.jp/graphql")
      .map((request) => request.body as { operationName?: string; variables?: Record<string, unknown> })
      .filter((payload) => payload.operationName === "ContentPageData")
      .map((payload) => String(payload.variables?.id ?? ""));
    expect(requestedContentIds).not.toContain("unrelated001");
  });
});
