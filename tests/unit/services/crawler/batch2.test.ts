import { DahliaCrawler } from "@main/services/crawler/sites/dahlia";
import { FalenoCrawler } from "@main/services/crawler/sites/faleno";
import { Fc2Crawler } from "@main/services/crawler/sites/fc2";
import { PrestigeCrawler } from "@main/services/crawler/sites/prestige";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
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
      name: "parses fc2 and strips watermark",
      number: "FC2-1234567",
      site: Website.FC2,
      fixtures: new Map<string, unknown>([
        [
          "https://adult.contents.fc2.com/article/1234567/",
          `<div data-section="userInfo"><h3>【個人撮影】可愛過ぎ-q-yosqny るシスター</h3></div><ul class="items_article_SampleImagesArea"><li><a href="https://img.example.com/fc2.jpg"></a></li></ul><div class="items_article_MainitemThumb"><img src="https://img.example.com/fc2s.jpg" /></div><p class="card-text"><a href="/tag/a">TagFC2</a></p><div class="col-8">Seller FC2</div>`,
        ],
      ]),
      createCrawler: (fixtures) => new Fc2Crawler(withGateway(new FixtureNetworkClient(fixtures))),
      verify: (data) => {
        expect(data.number).toBe("FC2-1234567");
        expect(data.title).toBe("【個人撮影】可愛過ぎるシスター");
      },
    },
    {
      name: "parses fc2 without stripping real hyphenated english phrases",
      number: "FC2-7654321",
      site: Website.FC2,
      fixtures: new Map<string, unknown>([
        [
          "https://adult.contents.fc2.com/article/7654321/",
          `<div data-section="userInfo"><h3>ナンパ大作戦 re-upload-more edition</h3></div><ul class="items_article_SampleImagesArea"><li><a href="https://img.example.com/fc2b.jpg"></a></li></ul><div class="items_article_MainitemThumb"><img src="https://img.example.com/fc2bs.jpg" /></div><p class="card-text"><a href="/tag/a">TagFC2</a></p><div class="col-8">Seller FC2</div>`,
        ],
      ]),
      createCrawler: (fixtures) => new Fc2Crawler(withGateway(new FixtureNetworkClient(fixtures))),
      verify: (data) => {
        expect(data.number).toBe("FC2-7654321");
        expect(data.title).toBe("ナンパ大作戦 re-upload-more edition");
      },
    },
    {
      name: "parses fc2 and strips dash-delimited obfuscated tokens between japanese phrases",
      number: "FC2-4157003",
      site: Website.FC2,
      fixtures: new Map<string, unknown>([
        [
          "https://adult.contents.fc2.com/article/4157003/",
          `<div data-section="userInfo"><h3>19歳のかわいい系ロシア巨乳ちゃん。-q-yosqny ぷりんぷりん</h3></div><ul class="items_article_SampleImagesArea"><li><a href="https://img.example.com/fc2d.jpg"></a></li></ul><div class="items_article_MainitemThumb"><img src="https://img.example.com/fc2ds.jpg" /></div><p class="card-text"><a href="/tag/a">TagFC2</a></p><div class="col-8">Seller FC2</div>`,
        ],
      ]),
      createCrawler: (fixtures) => new Fc2Crawler(withGateway(new FixtureNetworkClient(fixtures))),
      verify: (data) => {
        expect(data.number).toBe("FC2-4157003");
        expect(data.title).toBe("19歳のかわいい系ロシア巨乳ちゃん。ぷりんぷりん");
      },
    },
    {
      name: "parses fc2 and strips dash-delimited obfuscated tokens with multi-letter segments",
      number: "FC2-3933828",
      site: Website.FC2,
      fixtures: new Map<string, unknown>([
        [
          "https://adult.contents.fc2.com/article/3933828/",
          `<div data-section="userInfo"><h3>販売停止前作品 -zqxoo-jxzq 田舎暮らし</h3></div><ul class="items_article_SampleImagesArea"><li><a href="https://img.example.com/fc2e.jpg"></a></li></ul><div class="items_article_MainitemThumb"><img src="https://img.example.com/fc2es.jpg" /></div><p class="card-text"><a href="/tag/a">TagFC2</a></p><div class="col-8">Seller FC2</div>`,
        ],
      ]),
      createCrawler: (fixtures) => new Fc2Crawler(withGateway(new FixtureNetworkClient(fixtures))),
      verify: (data) => {
        expect(data.number).toBe("FC2-3933828");
        expect(data.title).toBe("販売停止前作品 田舎暮らし");
      },
    },
    {
      name: "parses fc2 and strips current star-delimited watermark fragments",
      number: "FC2-4428347",
      site: Website.FC2,
      fixtures: new Map<string, unknown>([
        [
          "https://adult.contents.fc2.com/article/4428347/",
          `<div data-section="userInfo"><h3>ま***pnpoz*xon りあ②</h3></div><ul class="items_article_SampleImagesArea"><li><a href="https://img.example.com/fc2c.jpg"></a></li></ul><div class="items_article_MainitemThumb"><img src="https://img.example.com/fc2cs.jpg" /></div><p class="card-text"><a href="/tag/a">TagFC2</a></p><div class="col-8">Seller FC2</div>`,
        ],
      ]),
      createCrawler: (fixtures) => new Fc2Crawler(withGateway(new FixtureNetworkClient(fixtures))),
      verify: (data) => {
        expect(data.number).toBe("FC2-4428347");
        expect(data.title).toBe("まりあ②");
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
