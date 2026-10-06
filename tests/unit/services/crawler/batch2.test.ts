import { DahliaCrawler } from "@mdcz/runtime/crawler/sites/dahlia";
import { FalenoCrawler } from "@mdcz/runtime/crawler/sites/faleno";
import { Fc2Crawler } from "@mdcz/runtime/crawler/sites/fc2";
import { PrestigeCrawler } from "@mdcz/runtime/crawler/sites/prestige";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";
import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("Maker and FC2 identity", () => {
  it("uses the exact WordPress slug and never accepts a similar work", async () => {
    for (const [Crawler, site, base, number, slug] of [
      [DahliaCrawler, Website.DAHLIA, "https://dahlia-av.jp", "DLDSS-30", "dldss30"],
      [FalenoCrawler, Website.FALENO, "https://faleno.jp/top", "FSDSS-56", "fsdss56"],
    ] as const) {
      const url = `${base}/wp-json/wp/v2/works?slug=${slug}`;
      const post = {
        slug,
        acf: { 作品名: "Title Actor", 出演女優: "Actor", 収録時間: "120分", "発売日（表示用）": "2024/06/20" },
        acf_custom_images: { main_photo_url: "https://example.com/cover.jpg" },
      };
      for (const posts of [[{ ...post, slug: `${slug}0` }, post], [{ ...post, slug: `${slug}0` }], []]) {
        const network = new FixtureNetworkClient(new Map([[url, posts]]));
        const response = await new Crawler(withGateway(network)).crawl({ number, site });
        if (posts.some((entry) => entry.slug === slug)) {
          expect(response.result).toMatchObject({
            success: true,
            data: { number, title: "Title", actors: ["Actor"], durationSeconds: 7200, release_date: "2024-06-20" },
          });
        } else {
          expect(response.result).toMatchObject({ success: false, reason: "not_found" });
        }
        expect(network.requests.map((request) => request.url)).toEqual([url]);
      }
    }
  });

  it("validates the Prestige product after matching the search result", async () => {
    const searchUrl = "https://www.prestige-av.com/api/search";
    const detailUrl = "https://www.prestige-av.com/api/product/uuid-1";
    for (const actual of ["ABW-130", "ABW-131", undefined]) {
      const network = new FixtureNetworkClient(
        new Map<string, unknown>([
          [searchUrl, { hits: { hits: [{ _source: { deliveryItemId: "ABW-130", productUuid: "uuid-1" } }] } }],
          [detailUrl, { title: "Prestige Title", sku: [{ deliveryItemId: actual }], actress: [{ name: "Actor" }] }],
        ]),
      );
      const response = await new PrestigeCrawler(withGateway(network)).crawl({
        number: "ABW-130",
        site: Website.PRESTIGE,
      });
      expect(response.result).toMatchObject(
        actual === "ABW-130"
          ? { success: true, data: { number: actual, actors: ["Actor"] } }
          : { success: false, reason: "not_found" },
      );
      expect(network.requests).toHaveLength(2);
    }
  });

  it("reads FC2 product identity while removing only the hidden title watermark", async () => {
    for (const [number, title, expected, date, release] of [
      [
        "4984259",
        'Title<span style="zoom:0.01">watermark</span> text',
        "Title text",
        "Sale Day : 2026/09/28",
        "2026-09-28",
      ],
      [
        "7654321",
        "Title re-upload-more **限定**",
        "Title re-upload-more **限定**",
        "販売日 : 2025/01/02",
        "2025-01-02",
      ],
    ]) {
      const url = `https://adult.contents.fc2.com/article/${number}/`;
      const html = `<div data-section="userInfo"><h3>${title}</h3></div><div class="items_article_softDevice"><p>${date}</p><p>Product ID : FC2 PPV ${number}</p></div>`;
      const crawler = new Fc2Crawler(withGateway(new FixtureNetworkClient(new Map([[url, html]]))));
      expect((await crawler.crawl({ number: `FC2-${number}`, site: Website.FC2 })).result).toMatchObject({
        success: true,
        data: { number: `FC2-${number}`, title: expected, release_date: release },
      });
    }
  });
});
