import { PpvDatabankCrawler } from "@main/services/crawler/sites/ppvdatabank";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("PpvDatabankCrawler", () => {
  it("parses a direct-hit detail page and reuses the search document", async () => {
    const searchUrl = "https://ppvdatabank.com/article/4663355/";
    const html = `
      <html>
        <head>
          <title>《歴史的映像》【ゆず故障】★最後は半外半中出し</title>
          <meta name="title" content="《歴史的映像》【ゆず故障】★最後は半外半中出し" />
        </head>
        <body>
          <div class="article_title">
            <a href="https://contents.fc2.com/aff.php?aid=4663355">《歴史的映像》【ゆず故障】★最後は半外半中出し</a>
          </div>
          <div class="article_top">
            <div class="thumb">
              <img src="https://ppvdatabank.com/article/4663355/img/thumb.webp" />
            </div>
            <ul class="meta">
              <li>販売日 : 2025/4/3</li>
              <li>再生時間 : 51:20</li>
              <li>発売価格 : 1000pt</li>
              <li>販売者 : <a href="https://ppvdatabank.com/channel/yuzukosyo">ゆず故障</a></li>
            </ul>
          </div>
          <ul class="sample_image_area">
            <li><a href="https://ppvdatabank.com/article/4663355/img/pl1.webp"><img src="ps1.webp" /></a></li>
            <li><a href="https://ppvdatabank.com/article/4663355/img/pl2.webp"><img src="ps2.webp" /></a></li>
            <li><a href="https://ppvdatabank.com/article/4663355/img/pl3.webp"><img src="ps3.webp" /></a></li>
          </ul>
          <div class="sample_movie_area">
            <iframe src="https://contents.fc2.com/embed/4663355?info=0"></iframe>
          </div>
          <div class="explanation">保存済みの補足説明</div>
        </body>
      </html>
    `;

    const crawler = new PpvDatabankCrawler(withGateway(new FixtureNetworkClient(new Map([[searchUrl, html]]))));

    const response = await crawler.crawl({
      number: "FC2-4663355",
      site: Website.PPVDATABANK,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.website).toBe(Website.PPVDATABANK);
    expect(response.result.data.number).toBe("FC2-4663355");
    expect(response.result.data.title).toBe("《歴史的映像》【ゆず故障】★最後は半外半中出し");
    expect(response.result.data.studio).toBe("ゆず故障");
    expect(response.result.data.publisher).toBe("ゆず故障");
    expect(response.result.data.release_date).toBe("2025-04-03");
    expect(response.result.data.durationSeconds).toBe(3_080);
    expect(response.result.data.plot).toBe("保存済みの補足説明");
    expect(response.result.data.thumb_url).toBe("https://ppvdatabank.com/article/4663355/img/thumb.webp");
    expect(response.result.data.poster_url).toBe("https://ppvdatabank.com/article/4663355/img/thumb.webp");
    expect(response.result.data.scene_images).toEqual([
      "https://ppvdatabank.com/article/4663355/img/pl1.webp",
      "https://ppvdatabank.com/article/4663355/img/pl2.webp",
      "https://ppvdatabank.com/article/4663355/img/pl3.webp",
    ]);
    expect(response.result.data.trailer_url).toBeUndefined();
  });

  it("classifies missing article pages as not_found", async () => {
    const searchUrl = "https://ppvdatabank.com/article/429568/";
    const html = `
      <html>
        <head><title>404 File Not Found</title></head>
        <body><h1>404</h1></body>
      </html>
    `;

    const crawler = new PpvDatabankCrawler(withGateway(new FixtureNetworkClient(new Map([[searchUrl, html]]))));

    const response = await crawler.crawl({
      number: "FC2-429568",
      site: Website.PPVDATABANK,
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("expected failure");
    }

    expect(response.result.failureReason).toBe("not_found");
    expect(response.result.error).toContain("Detail URL not found");
  });
});
