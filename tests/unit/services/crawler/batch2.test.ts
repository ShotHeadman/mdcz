import { DahliaCrawler } from "@mdcz/runtime/crawler/sites/dahlia";
import { FalenoCrawler } from "@mdcz/runtime/crawler/sites/faleno";
import { Fc2Crawler } from "@mdcz/runtime/crawler/sites/fc2";
import { PrestigeCrawler } from "@mdcz/runtime/crawler/sites/prestige";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("Batch2 crawlers", () => {
  const basicCases: Array<{
    name: string;
    number: string;
    site: Website;
    fixtures: Map<string, unknown>;
    createCrawler: (fixtures: Map<string, unknown>) => {
      crawl: (input: {
        number: string;
        site: Website;
      }) => Promise<{ result: { success: boolean; data?: CrawlerData } }>;
    };
    verify: (data: CrawlerData) => void;
  }> = [
    {
      name: "parses prestige api",
      number: "ABW-130",
      site: Website.PRESTIGE,
      fixtures: new Map<string, unknown>([
        [
          `https://www.prestige-av.com/api/search?isEnabledQuery=true&searchText=${encodeURIComponent("ABW-130")}&isEnableAggregation=false&release=false&reservation=false&soldOut=false&from=0&aggregationTermsSize=0&size=20`,
          { hits: { hits: [{ _source: { deliveryItemId: "ABW-130", productUuid: "uuid-1" } }] } },
        ],
        [
          "https://www.prestige-av.com/api/product/uuid-1",
          {
            title: "Prestige Title",
            body: "Plot",
            actress: [{ name: "Actor P" }],
            genre: [{ name: "TagP" }],
            maker: { name: "MakerP" },
            label: { name: "LabelP" },
          },
        ],
      ]),
      createCrawler: (fixtures) => new PrestigeCrawler(withGateway(new FixtureNetworkClient(fixtures))),
      verify: (data) => {
        expect(data.title).toBe("Prestige Title");
      },
    },
    {
      name: "parses faleno",
      number: "FSDSS-564",
      site: Website.FALENO,
      fixtures: new Map<string, unknown>([
        [
          `https://faleno.jp/top/?s=${encodeURIComponent("fsdss 564")}`,
          `<div class="text_name"><a href="https://faleno.jp/top/works/fsdss564/">link</a></div>`,
        ],
        [
          "https://faleno.jp/top/works/fsdss564/",
          `<h1>Faleno Title Actor F</h1><span>出演女優</span><p>Actor F</p><a class="pop_sample"><img src="https://img.example.com/faleno_1200.jpg" /></a><div class="box_works01_text"><p>Plot F</p></div>`,
        ],
      ]),
      createCrawler: (fixtures) => new FalenoCrawler(withGateway(new FixtureNetworkClient(fixtures))),
      verify: (_data) => {},
    },
    {
      name: "parses dahlia",
      number: "DLDSS-177",
      site: Website.DAHLIA,
      fixtures: new Map<string, unknown>([
        [
          "https://dahlia-av.jp/works/dldss177/",
          `<h1>Dahlia Title Actor D</h1><span>出演女優</span><p>Actor D</p><a class="pop_sample"><img src="https://img.example.com/dahlia_1200.jpg" /></a><div class="box_works01_text"><p>Plot D</p></div>`,
        ],
      ]),
      createCrawler: (fixtures) => new DahliaCrawler(withGateway(new FixtureNetworkClient(fixtures))),
      verify: (_data) => {},
    },
    {
      name: "parses fc2 without its hidden title watermark and with an english sale date",
      number: "FC2-4984259",
      site: Website.FC2,
      fixtures: new Map<string, unknown>([
        [
          "https://adult.contents.fc2.com/article/4984259/",
          `<div data-section="userInfo"><h3>【個人撮影】可愛過ぎ<span style="zoom:0.01;color:#fff;width:1px;height:1px;display:inline-block;overflow:hidden;">**znoqnxxxjn </span>るシスター</h3></div><ul class="items_article_SampleImagesArea"><li><a href="https://img.example.com/fc2.jpg"></a></li></ul><div class="items_article_MainitemThumb"><img src="https://img.example.com/fc2s.jpg" /></div><p class="card-text"><a href="/tag/a">TagFC2</a></p><div class="col-8">Seller FC2</div><div class="items_article_softDevice"><p>Sale Day : 2026/09/28</p></div><div class="items_article_softDevice"><p>Product ID : FC2 PPV 4984259</p></div>`,
        ],
      ]),
      createCrawler: (fixtures) => new Fc2Crawler(withGateway(new FixtureNetworkClient(fixtures))),
      verify: (data) => {
        expect(data.number).toBe("FC2-4984259");
        expect(data.title).toBe("【個人撮影】可愛過ぎるシスター");
        expect(data.release_date).toBe("2026-09-28");
      },
    },
    {
      name: "parses fc2 keeping visible title text and a japanese sale date",
      number: "FC2-7654321",
      site: Website.FC2,
      fixtures: new Map<string, unknown>([
        [
          "https://adult.contents.fc2.com/article/7654321/",
          `<div data-section="userInfo"><h3>ナンパ大作戦 re-upload-more edition **限定**</h3></div><ul class="items_article_SampleImagesArea"><li><a href="https://img.example.com/fc2b.jpg"></a></li></ul><div class="items_article_MainitemThumb"><img src="https://img.example.com/fc2bs.jpg" /></div><p class="card-text"><a href="/tag/a">TagFC2</a></p><div class="col-8">Seller FC2</div><div class="items_article_softDevice"><p>販売日 : 2025/01/02</p></div>`,
        ],
      ]),
      createCrawler: (fixtures) => new Fc2Crawler(withGateway(new FixtureNetworkClient(fixtures))),
      verify: (data) => {
        expect(data.number).toBe("FC2-7654321");
        expect(data.title).toBe("ナンパ大作戦 re-upload-more edition **限定**");
        expect(data.release_date).toBe("2025-01-02");
      },
    },
  ];

  it.each(basicCases)("$name", async ({ number, site, fixtures, createCrawler, verify }) => {
    const crawler = createCrawler(fixtures);
    const response = await crawler.crawl({ number, site });
    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }
    const data = response.result.data;
    if (!data) {
      throw new Error("expected crawler data");
    }
    expect(data.website).toBe(site);
    verify(data);
  });
});
