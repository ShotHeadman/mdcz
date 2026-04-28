import { MGStageCrawler } from "@main/services/crawler/sites/mgstage";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("MGStageCrawler", () => {
  it("matches separator variants in search results and parses the detail page", async () => {
    const number = "ABP-075";
    const searchUrl = "https://www.mgstage.com/search/cSearch.php?search_word=ABP-075";
    const detailUrl = "https://www.mgstage.com/product/product_detail/ABP_075/";

    const searchHtml = `
      <html><body>
        <a href="/product/product_detail/SSIS-999/">wrong</a>
        <a href="/product/product_detail/ABP_075/">detail</a>
      </body></html>
    `;

    const detailHtml = `
      <html><body>
        <h1 class="tag">ABP-075 Sample Title - MGS動画</h1>
        <table>
          <tr><th>品番</th><td>ABP-075</td></tr>
          <tr><th>配信開始日</th><td>2024-01-02</td></tr>
          <tr><th>メーカー</th><td>Studio A</td></tr>
          <tr><th>レーベル</th><td>Label A</td></tr>
          <tr><th>シリーズ</th><td>Series A</td></tr>
        </table>
        <a href="/search/cSearch.php?tag_id=1">Actor A</a>
        <a href="/search/cSearch.php?tag_id=2">Actor B</a>
        <a href="/search/cSearch.php?genre=10">Genre A</a>
        <a href="/search/cSearch.php?genre=20">Genre B</a>
        <p class="txt introduction">Sample plot</p>
        <a class="enlarge_image" href="/images/cover.jpg">cover</a>
        <a class="sample_image" href="/images/sample1.jpg">1</a>
        <a class="sample_image" href="https://cdn.example.com/sample2.jpg">2</a>
        <span class="review_average">4.2</span>
      </body></html>
    `;

    const fixtures = new Map<string, string>([
      [searchUrl, searchHtml],
      [detailUrl, detailHtml],
    ]);
    const crawler = new MGStageCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number,
      site: Website.MGSTAGE,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.website).toBe(Website.MGSTAGE);
    expect(response.result.data.number).toBe("ABP-075");
    expect(response.result.data.title).toBe("ABP-075 Sample Title");
    expect(response.result.data.actors).toEqual(["Actor A", "Actor B"]);
    expect(response.result.data.genres).toEqual(["Genre A", "Genre B"]);
    expect(response.result.data.release_date).toBe("2024-01-02");
    expect(response.result.data.studio).toBe("Studio A");
    expect(response.result.data.publisher).toBe("Label A");
    expect(response.result.data.series).toBe("Series A");
    expect(response.result.data.plot).toBe("Sample plot");
    expect(response.result.data.thumb_url).toBe("https://www.mgstage.com/images/cover.jpg");
    expect(response.result.data.scene_images).toEqual([
      "https://www.mgstage.com/images/sample1.jpg",
      "https://cdn.example.com/sample2.jpg",
    ]);
    expect(response.result.data.rating).toBe(8.4);
  });
});
