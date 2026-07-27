import { readFileSync } from "node:fs";
import { DmmCrawler } from "@mdcz/runtime/crawler/sites/dmm";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

type DmmResponse = Awaited<ReturnType<DmmCrawler["crawl"]>>;

const fixture = (name: string): string =>
  readFileSync(new URL(`../../../fixtures/crawler/dmm/${name}.txt`, import.meta.url), "utf8");

const searchHtml = (detailUrl: string): string => `
  <html><body><script>const item = {"detailUrl":"${detailUrl.replaceAll("/", "\\/")}"};</script></body></html>
`;

const successfulData = (response: DmmResponse) => {
  expect(response.result.success).toBe(true);
  if (!response.result.success) throw new Error("expected success");
  return response.result.data;
};

describe("DmmCrawler", () => {
  it("parses supported DMM detail pages and keeps native DMM image URLs", async () => {
    const cases = [
      {
        number: "SSIS-497",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=ssis00497/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00497/",
        detailHtml: fixture("ssis-497-detail"),
        assert: (response: DmmResponse, networkClient: FixtureNetworkClient) => {
          const data = successfulData(response);
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
        detailHtml: fixture("genre-merge-detail"),
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
            "Tag11",
            "Tag12",
            "Tag13",
          ]);
        },
      },
      {
        number: "MNGS-051",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=mngs00051/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=mngs00051/",
        detailHtml: fixture("noise-isolation-detail"),
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
        detailHtml: fixture("aws-optimization-detail"),
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
        detailHtml: fixture("region-blocked-detail"),
        expectedError: "DMM: region blocked",
      },
      {
        number: "DLDSS-463",
        searchUrl: "https://www.dmm.co.jp/search/=/searchstr=dldss00463/sort=ranking/",
        detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=dldss00463/",
        detailHtml: fixture("unrendered-shell-detail"),
        expectedError: "DMM: unrendered shell",
      },
    ];

    for (const { number, searchUrl, detailUrl, detailHtml, expectedError } of cases) {
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

  it("uses manual detail URLs directly without running search", async () => {
    const detailUrl = "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=ssis00497/";
    const networkClient = new FixtureNetworkClient(new Map<string, unknown>([[detailUrl, fixture("direct-detail")]]));
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

  it("routes video.dmm.co.jp search candidates through GraphQL without fetching the shell detail page", async () => {
    const number = "STARS-804";
    const searchUrl = "https://www.dmm.co.jp/search/=/searchstr=stars00804/sort=ranking/";
    const videoDetailUrl = "https://video.dmm.co.jp/av/content/?id=1stars00804";
    const graphqlUrl = "https://api.video.dmm.co.jp/graphql";
    const searchHtml = `
      <html><body>
        <script>
          window.__DMM_SEARCH__ = {
            "contents": {
              "data": [{
                "contentID": "1stars00804",
                "title": "STARS-804 Embedded Search Hit",
                "detailURL": "${videoDetailUrl}"
              }]
            }
          };
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
                title: "DMM Video GraphQL Title",
                makerContentId: "STARS-804",
                description: "Recovered from video GraphQL",
                makerReleasedAt: "2025-05-17T00:00:00Z",
                duration: 5400,
                packageImage: {
                  largeUrl: "https://cdn.example.com/dmm-video-cover.jpg",
                  mediumUrl: "https://cdn.example.com/dmm-video-poster.jpg",
                },
                sampleImages: [{ largeImageUrl: "https://cdn.example.com/dmm-video-sample.jpg" }],
                actresses: [{ name: "Actor Video" }],
                genres: [{ name: "Tag Video" }],
              },
              reviewSummary: { average: 4.4 },
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
    expect(response.result.data.title).toBe("DMM Video GraphQL Title");
    expect(response.result.data.number).toBe("STARS-804");
    expect(response.result.data.durationSeconds).toBe(5400);
    expect(networkClient.requests.map((request) => request.url)).toEqual([searchUrl]);
  });

  it("routes tv.dmm.co.jp list search candidates through DMM Video GraphQL", async () => {
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

  it("falls back to matched public search metadata when DMM Video GraphQL has no result", async () => {
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

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data).toMatchObject({
      title,
      number,
      website: Website.DMM,
      thumb_url: "https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497pl.jpg",
      poster_url: posterUrl,
    });
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
    expect(response.result.failureReason).toBe("region_blocked");
    expect(response.result.error).toBe("DMM: region blocked");
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
      [detailUrl, fixture("knbm-search-recovery-detail")],
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
