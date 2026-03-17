import { JavbusCrawler } from "@main/services/crawler/sites/javbus";

import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("JavbusCrawler", () => {
  it("parses search + detail pages into CrawlerData", async () => {
    const number = "ABP-123";

    const searchUrl = `https://www.javbus.com/search/${encodeURIComponent(number)}`;
    const detailUrl = "https://www.javbus.com/ABP-123";

    const searchHtml = `
      <html><body>
        <a class="movie-box" href="https://www.javbus.com/SSIS-999"></a>
        <a class="movie-box" href="${detailUrl}"></a>
      </body></html>
    `;

    const detailHtml = `
      <html><body>
        <h3>${number} The Title</h3>
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
    `;

    const fixtures = new Map<string, string>([
      [searchUrl, searchHtml],
      [detailUrl, detailHtml],
    ]);
    const networkClient = new FixtureNetworkClient(fixtures);
    const crawler = new JavbusCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number,
      site: Website.JAVBUS,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    const data = response.result.data;
    expect(data.website).toBe(Website.JAVBUS);
    expect(data.number).toBe(number);
    expect(data.title).toBe("The Title");
    expect(data.actors).toEqual(["Actor A", "Actor B"]);
    expect(data.genres).toEqual(["Genre A", "Genre B"]);
    expect(data.release_date).toBe("2020-01-02");
    expect(data.thumb_url).toBe("https://www.javbus.com/pics/cover/abc_b.jpg");
    expect(data.poster_url).toBe("https://www.javbus.com/pics/thumb/abc.jpg");
    expect(data.studio).toBe("StudioName");
    expect(data.publisher).toBe("PublisherName");
    expect(data.director).toBe("DirectorName");
    expect(data.series).toBe("SeriesName");
    expect(data.sample_images).toEqual([
      "https://www.javbus.com/pics/sample1.jpg",
      "https://www.javbus.com/pics/sample2.jpg",
    ]);
  });

  it("matches detail links with underscore code variants", async () => {
    const number = "ABP-075";

    const searchUrl = `https://www.javbus.com/search/${encodeURIComponent(number)}`;
    const detailUrl = "https://www.javbus.com/ABP_075";

    const searchHtml = `
      <html><body>
        <a class="movie-box" href="${detailUrl}"></a>
      </body></html>
    `;

    const detailHtml = `
      <html><body>
        <h3>${number} Title With Underscore URL</h3>
        <div class="info">
          <p><span class="header">識別碼:</span> <span>ABP-075</span></p>
        </div>
      </body></html>
    `;

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
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.number).toBe(number);
    expect(response.result.data.title).toBe("Title With Underscore URL");
  });

  it("returns explicit error when Javbus age verification page is served", async () => {
    const number = "ABP-075";
    const searchUrl = `https://www.javbus.com/search/${encodeURIComponent(number)}`;

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
