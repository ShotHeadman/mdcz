import { JavbusCrawler } from "@main/services/crawler/sites/javbus";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("JavbusCrawler", () => {
  it("parses detail pages and matches underscore code variants from search results", async () => {
    const cases = [
      {
        number: "ABP-123",
        searchUrl: "https://www.javbus.com/search/ABP-123",
        detailUrl: "https://www.javbus.com/ABP-123",
        searchHtml: `
          <html><body>
            <a class="movie-box" href="https://www.javbus.com/SSIS-999"></a>
            <a class="movie-box" href="https://www.javbus.com/ABP-123"></a>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <h3>ABP-123 The Title</h3>
            <div class="info">
              <p><span class="header">識別碼:</span> <span>ABP-123</span></p>
              <p><span class="header">發行日期:</span> <span>2020-01-02</span></p>
              <p><span class="header">長度:</span> <span>120 分鐘</span></p>
            </div>
            <div class="star-name"><a>Actor A</a></div>
            <div class="star-name"><a>Actor B</a></div>
            <span class="genre"><label><a href="/genre/abc">Genre A</a></label></span>
            <span class="genre"><label><a href="/genre/def">Genre B</a></label></span>
            <a class="bigImage" href="https://www.javbus.com/pics/cover/abc_b.jpg">cover</a>
            <a href="/studio/studio1">StudioName</a>
            <a href="/label/label1">PublisherName</a>
            <a href="/director/director1">DirectorName</a>
            <a href="/series/series1">SeriesName</a>
            <div id="sample-waterfall">
              <a href="/pics/sample1.jpg">1</a>
              <a href="https://www.javbus.com/pics/sample2.jpg">2</a>
            </div>
          </body></html>
        `,
        assert: (data: Awaited<ReturnType<JavbusCrawler["crawl"]>>) => {
          if (!data.result.success) {
            throw new Error("expected success");
          }
          expect(data.result.data.website).toBe(Website.JAVBUS);
          expect(data.result.data.number).toBe("ABP-123");
          expect(data.result.data.title).toBe("The Title");
          expect(data.result.data.actors).toEqual(["Actor A", "Actor B"]);
          expect(data.result.data.genres).toEqual(["Genre A", "Genre B"]);
          expect(data.result.data.release_date).toBe("2020-01-02");
          expect(data.result.data.thumb_url).toBe("https://www.javbus.com/pics/cover/abc_b.jpg");
          expect(data.result.data.poster_url).toBe("https://www.javbus.com/pics/thumb/abc.jpg");
          expect(data.result.data.studio).toBe("StudioName");
          expect(data.result.data.publisher).toBe("PublisherName");
          expect(data.result.data.director).toBe("DirectorName");
          expect(data.result.data.series).toBe("SeriesName");
          expect(data.result.data.scene_images).toEqual([
            "https://www.javbus.com/pics/sample1.jpg",
            "https://www.javbus.com/pics/sample2.jpg",
          ]);
        },
      },
      {
        number: "ABP-075",
        searchUrl: "https://www.javbus.com/search/ABP-075",
        detailUrl: "https://www.javbus.com/ABP_075",
        searchHtml: `
          <html><body>
            <a class="movie-box" href="https://www.javbus.com/ABP_075"></a>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <h3>ABP-075 Title With Underscore URL</h3>
            <div class="info">
              <p><span class="header">識別碼:</span> <span>ABP-075</span></p>
            </div>
          </body></html>
        `,
        assert: (data: Awaited<ReturnType<JavbusCrawler["crawl"]>>) => {
          if (!data.result.success) {
            throw new Error("expected success");
          }
          expect(data.result.data.number).toBe("ABP-075");
          expect(data.result.data.title).toBe("Title With Underscore URL");
        },
      },
      {
        number: "ABP-999",
        searchUrl: "https://www.javbus.com/search/ABP-999",
        detailUrl: "https://www.javbus.com/ABP-999",
        searchHtml: `
          <html><body>
            <a class="movie-box" href="https://www.javbus.com/SSIS-001"></a>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <h3>ABP-999 Fallback Detail URL</h3>
            <div class="info">
              <p><span class="header">識別碼:</span> <span>ABP-999</span></p>
            </div>
          </body></html>
        `,
        assert: (data: Awaited<ReturnType<JavbusCrawler["crawl"]>>) => {
          if (!data.result.success) {
            throw new Error("expected success");
          }
          expect(data.result.data.number).toBe("ABP-999");
          expect(data.result.data.title).toBe("Fallback Detail URL");
        },
      },
    ];

    for (const { number, searchUrl, detailUrl, searchHtml, detailHtml, assert } of cases) {
      const fixtures = new Map<string, string>([
        [searchUrl, searchHtml],
        [detailUrl, detailHtml],
      ]);
      const crawler = new JavbusCrawler(withGateway(new FixtureNetworkClient(fixtures)));

      const response = await crawler.crawl({
        number,
        site: Website.JAVBUS,
      });

      expect(response.result.success).toBe(true);
      assert(response as Awaited<ReturnType<JavbusCrawler["crawl"]>>);
    }
  });

  it("returns an explicit error when Javbus serves the age verification page", async () => {
    const number = "ABP-075";
    const searchUrl = "https://www.javbus.com/search/ABP-075";

    const searchHtml = `
      <html>
        <head><title>Age Verification JavBus - JavBus</title></head>
        <body>
          <div id="ageVerify"></div>
          <h4 class="modal-title">你是否已經成年?</h4>
        </body>
      </html>
    `;

    const fixtures = new Map<string, string>([[searchUrl, searchHtml]]);
    const crawler = new JavbusCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number,
      site: Website.JAVBUS,
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("expected failure");
    }

    expect(response.result.error).toContain("age verification");
  });
});
