import { Jav321Crawler } from "@main/services/crawler/sites/jav321";
import type { NetworkClient } from "@main/services/network";
import { Website } from "@mdcz/shared/enums";
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
  it("parses actor names from plain text and linked rows", async () => {
    const cases = [
      {
        number: "ABF-075",
        searchHtml: `
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
        `,
        detailHtmlByUrl: new Map([
          [
            "https://www.jav321.com/search",
            `
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
          `,
          ],
        ]),
        expectedNumber: "abf-075",
        expectedActors: ["瀧本雫葉"],
      },
      {
        number: "EBWH-241",
        searchHtml: `
          <html><body>
            <a href="/video/ebwh00241">detail</a>
          </body></html>
        `,
        detailHtmlByUrl: new Map([
          [
            "https://www.jav321.com/video/ebwh00241",
            `
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
          `,
          ],
        ]),
        expectedNumber: "EBWH-241",
        expectedActors: ["千咲ちな"],
      },
      {
        number: "ABF-075",
        searchHtml: `
          <html><body>
            <a href="/video/ssis99999">wrong</a>
            <a href="/video/abf075">detail</a>
          </body></html>
        `,
        detailHtmlByUrl: new Map([
          [
            "https://www.jav321.com/video/abf075",
            `
            <html><body>
              <div class="panel-heading"><h3>ABF-075 title</h3></div>
              <div class="panel-body">
                <div class="row">
                  <div class="col-md-9">
                    <b>出演者</b>: <a href="/star/1">Actor A</a><br>
                    <b>メーカー</b>: <a href="/company/prestige/1">プレステージ</a><br>
                    <b>品番</b>: ABF-075<br>
                    <b>配信開始日</b>: 2024-02-08<br>
                  </div>
                </div>
              </div>
            </body></html>
          `,
          ],
        ]),
        expectedNumber: "ABF-075",
        expectedActors: ["Actor A"],
      },
    ];

    for (const { number, searchHtml, detailHtmlByUrl, expectedNumber, expectedActors } of cases) {
      const crawler = new Jav321Crawler(withGateway(createNetworkClient(searchHtml, detailHtmlByUrl)));

      const response = await crawler.crawl({
        number,
        site: Website.JAV321,
      });

      expect(response.result.success).toBe(true);
      if (!response.result.success) {
        throw new Error("expected success");
      }

      expect(response.result.data.number).toBe(expectedNumber);
      expect(response.result.data.actors).toEqual(expectedActors);
    }
  });
});
