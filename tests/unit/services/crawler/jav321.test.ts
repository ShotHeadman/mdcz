import { Jav321Crawler } from "@main/services/crawler/sites/jav321";
import type { NetworkClient } from "@main/services/network";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

import { withGateway } from "./fixtures";

const createNetworkClient = (searchHtml: string, detailHtmlByUrl: Map<string, string> = new Map()) =>
  ({
    async postText(url: string): Promise<string> {
      if (url !== "https://www.jav321.com/search") {
        throw new Error(`Unexpected POST URL ${url}`);
      }

      return searchHtml;
    },

    async getText(url: string): Promise<string> {
      const fixture = detailHtmlByUrl.get(url);
      if (!fixture) {
        throw new Error(`Unexpected GET URL ${url}`);
      }

      return fixture;
    },
  }) as unknown as NetworkClient;

describe("Jav321Crawler", () => {
  it("falls back to plain-text actors when the detail page has no /star/ links", async () => {
    const number = "ABF-075";
    const searchUrl = "https://www.jav321.com/search";

    const detailHtml = `
      <html><body>
        <div class="panel-heading"><h3>ABF-075 title</h3></div>
        <div class="panel-body">
          <div class="row">
            <div class="col-md-9">
              <b>出演者</b>: 瀧本雫葉 &nbsp; <br>
              <b>メーカー</b>: <a href="/company/prestige/1">プレステージ</a><br>
              <b>品番</b>: abf-075<br>
              <b>配信開始日</b>: 2024-02-08<br>
            </div>
          </div>
        </div>
      </body></html>
    `;

    const crawler = new Jav321Crawler(withGateway(createNetworkClient(detailHtml, new Map([[searchUrl, detailHtml]]))));

    const response = await crawler.crawl({
      number,
      site: Website.JAV321,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.number).toBe("abf-075");
    expect(response.result.data.actors).toEqual(["瀧本雫葉"]);
  });

  it("keeps linked actors for pages like EBWH-241 and STARS-804", async () => {
    const number = "EBWH-241";
    const detailUrl = "https://www.jav321.com/video/ebwh00241";

    const searchHtml = `
      <html><body>
        <a href="/video/ebwh00241">detail</a>
      </body></html>
    `;

    const detailHtml = `
      <html><body>
        <div class="panel-heading"><h3>EBWH-241 title</h3></div>
        <div class="panel-body">
          <div class="row">
            <div class="col-md-9">
              <b>出演者</b>: <a href="/star/1104926/1">千咲ちな</a> &nbsp; <br>
              <b>メーカー</b>: <a href="/company/ebody/1">E-BODY</a><br>
              <b>品番</b>: EBWH-241<br>
              <b>配信開始日</b>: 2024-01-01<br>
            </div>
          </div>
        </div>
      </body></html>
    `;

    const crawler = new Jav321Crawler(withGateway(createNetworkClient(searchHtml, new Map([[detailUrl, detailHtml]]))));

    const response = await crawler.crawl({
      number,
      site: Website.JAV321,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.number).toBe("EBWH-241");
    expect(response.result.data.actors).toEqual(["千咲ちな"]);
  });
});
