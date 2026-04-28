import { AvbaseCrawler } from "@main/services/crawler/sites/avbase";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

const createNextDataHtml = (pageProps: Record<string, unknown>, bodyHtml = ""): string => {
  return `<html><body>${bodyHtml}<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></body></html>`;
};

interface ProductOptions {
  description?: string;
  director?: string;
  imageUrl?: string;
  label?: string;
  maker?: string;
  sceneImages?: string[];
  series?: string;
  thumbnailUrl?: string;
  volume?: string;
}

const createProduct = ({
  description,
  director,
  imageUrl,
  label,
  maker,
  sceneImages = [],
  series,
  thumbnailUrl,
  volume,
}: ProductOptions = {}) => {
  return {
    image_url: imageUrl,
    thumbnail_url: thumbnailUrl,
    maker: maker ? { name: maker } : undefined,
    label: label ? { name: label } : undefined,
    series: series ? { name: series } : undefined,
    sample_image_urls: sceneImages.map((url) => ({ l: url })),
    iteminfo: {
      description,
      director,
      volume,
    },
  };
};

interface SearchWorkOptions {
  minDate?: string;
  prefix?: string;
  products?: ReturnType<typeof createProduct>[];
  title: string;
  workId: string;
}

const createSearchWork = ({
  minDate = "Wed Mar 11 2026 09:00:00 GMT+0900 (Japan Standard Time)",
  prefix = "",
  products = [],
  title,
  workId,
}: SearchWorkOptions) => {
  return {
    prefix,
    work_id: workId,
    title,
    min_date: minDate,
    actors: [],
    tags: [],
    relworks: {
      children: [],
      parents: [],
    },
    products,
  };
};

interface DetailWorkOptions {
  actors?: string[];
  detailActors?: string[];
  genres?: string[];
  minDate?: string;
  products?: ReturnType<typeof createProduct>[];
  title: string;
  workId: string;
}

const createDetailWork = ({
  actors = [],
  detailActors = [],
  genres = [],
  minDate = "Wed Mar 11 2026 09:00:00 GMT+0900 (Japan Standard Time)",
  products = [],
  title,
  workId,
}: DetailWorkOptions) => {
  return {
    prefix: "",
    work_id: workId,
    title,
    min_date: minDate,
    casts: actors.map((name) => ({
      actor: {
        name,
      },
    })),
    actors: detailActors.map((name) => ({
      name,
    })),
    genres: genres.map((name) => ({ name })),
    products,
  };
};

describe("AvbaseCrawler", () => {
  it("matches search results and aggregates detail metadata across AVBase product variants", async () => {
    const cases = [
      {
        number: "abf-075",
        searchUrl: "https://www.avbase.net/works?q=abf-075",
        detailUrl: "https://www.avbase.net/works/prestige:ABF-075",
        searchHtml: createNextDataHtml({
          works: [
            createSearchWork({
              prefix: "prestige",
              workId: "ABF-075",
              title: "天然成分由来 瀧本雫葉汁 120％ 83",
              minDate: "Thu Feb 08 2024 09:00:00 GMT+0900 (Japan Standard Time)",
              products: [createProduct(), createProduct(), createProduct()],
            }),
            createSearchWork({
              prefix: "eiten",
              workId: "ABF-075",
              title: "変態女子 フェラチオ専用娘 Aimi",
              minDate: "Fri Sep 19 2014 09:00:00 GMT+0900 (Japan Standard Time)",
              products: [createProduct(), createProduct()],
            }),
          ],
        }),
        detailHtml: createNextDataHtml({
          work: createDetailWork({
            workId: "ABF-075",
            title: "天然成分由来 瀧本雫葉汁 120％ 83（瀧本雫葉）",
            minDate: "Thu Feb 08 2024 09:00:00 GMT+0900 (Japan Standard Time)",
            actors: ["瀧本雫葉"],
            genres: ["巨乳", "潮吹き"],
            products: [
              createProduct({
                maker: "プレステージ",
                label: "ABSOLUTELY FANTASIA",
                series: "天然成分由来○○汁100％",
                director: "チャーリー中田",
                volume: "125",
                imageUrl: "https://pics.dmm.co.jp/mono/movie/adult/118abf075/118abf075pl.jpg",
                thumbnailUrl: "https://pics.dmm.co.jp/mono/movie/adult/118abf075/118abf075ps.jpg",
                sceneImages: [
                  "https://pics.dmm.co.jp/digital/video/118abf075/118abf075jp-1.jpg",
                  "https://pics.dmm.co.jp/digital/video/118abf075/118abf075jp-2.jpg",
                ],
              }),
              createProduct({
                maker: "PRESTIGE",
                label: "プレステージ",
                series: "天然成分由来○○汁100％",
                description: "プレステージ専属女優『瀧本雫葉』が汁まみれの濃密性交を繰り広げる！",
                volume: "126",
                imageUrl: "https://pic.duga.jp/unsecure/prestige/6763/noauth/jacket.jpg",
                thumbnailUrl: "https://pic.duga.jp/unsecure/prestige/6763/noauth/jacket_240.jpg",
                sceneImages: ["https://pic.duga.jp/unsecure/prestige/6763/cap/0001.jpg"],
              }),
              createProduct({
                maker: "プレステージ",
                label: "ABSOLUTELY FANTASIA",
                series: "天然成分由来",
                description: "【MGSだけのおまけ映像付き+10分】",
                volume: "135分",
                imageUrl: "https://image.mgstage.com/images/prestige/sp/abf/075/pake-03_sp-abf-075.jpg",
                thumbnailUrl: "https://image.mgstage.com/images/prestige/sp/abf/075/h1-06_sp-abf-075.jpg",
                sceneImages: [
                  "https://image.mgstage.com/images/prestige/sp/abf/075/popsample1_sp-abf-075.jpg",
                  "https://image.mgstage.com/images/prestige/sp/abf/075/popsample2_sp-abf-075.jpg",
                  "https://image.mgstage.com/images/prestige/sp/abf/075/popsample3_sp-abf-075.jpg",
                  "https://image.mgstage.com/images/prestige/sp/abf/075/popsample4_sp-abf-075.jpg",
                ],
              }),
            ],
          }),
        }),
        assert: (response: Awaited<ReturnType<AvbaseCrawler["crawl"]>>, networkClient: FixtureNetworkClient) => {
          if (!response.result.success) {
            throw new Error("expected success");
          }

          const data = response.result.data;
          expect(data.website).toBe(Website.AVBASE);
          expect(data.number).toBe("ABF-075");
          expect(data.title).toBe("天然成分由来 瀧本雫葉汁 120％ 83");
          expect(data.actors).toEqual(["瀧本雫葉"]);
          expect(data.genres).toEqual(["巨乳", "潮吹き"]);
          expect(data.studio).toBe("プレステージ");
          expect(data.publisher).toBe("ABSOLUTELY FANTASIA");
          expect(data.series).toBe("天然成分由来○○汁100％");
          expect(data.director).toBe("チャーリー中田");
          expect(data.plot).toBe("プレステージ専属女優『瀧本雫葉』が汁まみれの濃密性交を繰り広げる！");
          expect(data.release_date).toBe("2024-02-08");
          expect(data.durationSeconds).toBe(125 * 60);
          expect(data.thumb_url).toBe("https://pics.dmm.co.jp/mono/movie/adult/118abf075/118abf075pl.jpg");
          expect(data.poster_url).toBe("https://pics.dmm.co.jp/mono/movie/adult/118abf075/118abf075ps.jpg");
          expect(data.scene_images).toEqual([
            "https://image.mgstage.com/images/prestige/sp/abf/075/popsample1_sp-abf-075.jpg",
            "https://image.mgstage.com/images/prestige/sp/abf/075/popsample2_sp-abf-075.jpg",
            "https://image.mgstage.com/images/prestige/sp/abf/075/popsample3_sp-abf-075.jpg",
            "https://image.mgstage.com/images/prestige/sp/abf/075/popsample4_sp-abf-075.jpg",
          ]);
          expect(networkClient.requests.map((request) => request.url)).toEqual([
            "https://www.avbase.net/works?q=abf-075",
            "https://www.avbase.net/works/prestige:ABF-075",
          ]);
        },
      },
      {
        number: "TPC-056",
        searchUrl: "https://www.avbase.net/works?q=TPC-056",
        detailUrl: "https://www.avbase.net/works/TPC-056",
        searchHtml: createNextDataHtml({
          works: [
            createSearchWork({
              workId: "TPC-056",
              title: "しおんさん",
              products: [createProduct()],
            }),
          ],
        }),
        detailHtml: createNextDataHtml({
          work: createDetailWork({
            workId: "TPC-056",
            title: "しおんさん",
            actors: ["しおん"],
            genres: ["ハメ撮り"],
            products: [
              createProduct({
                maker: "東京恋愛",
                volume: "135分",
              }),
            ],
          }),
        }),
        assert: (response: Awaited<ReturnType<AvbaseCrawler["crawl"]>>, networkClient: FixtureNetworkClient) => {
          if (!response.result.success) {
            throw new Error("expected success");
          }

          expect(response.result.data.number).toBe("TPC-056");
          expect(response.result.data.actors).toEqual(["しおん"]);
          expect(response.result.data.genres).toEqual(["ハメ撮り"]);
          expect(response.result.data.studio).toBe("東京恋愛");
          expect(response.result.data.durationSeconds).toBe(135 * 60);
          expect(networkClient.requests.map((request) => request.url)).toEqual([
            "https://www.avbase.net/works?q=TPC-056",
            "https://www.avbase.net/works/TPC-056",
          ]);
        },
      },
    ];

    for (const { number, searchUrl, detailUrl, searchHtml, detailHtml, assert } of cases) {
      const networkClient = new FixtureNetworkClient(
        new Map<string, unknown>([
          [searchUrl, searchHtml],
          [detailUrl, detailHtml],
        ]),
      );
      const crawler = new AvbaseCrawler(withGateway(networkClient));

      const response = await crawler.crawl({
        number,
        site: Website.AVBASE,
      });

      expect(response.result.success).toBe(true);
      assert(response, networkClient);
    }
  });

  it("returns not_found when the AVBase search page has no matching work", async () => {
    const number = "ABF-999";
    const searchUrl = "https://www.avbase.net/works?q=ABF-999";

    const searchHtml = createNextDataHtml({
      works: [
        createSearchWork({
          prefix: "prestige",
          workId: "ABF-075",
          title: "天然成分由来 瀧本雫葉汁 120％ 83",
          products: [createProduct()],
        }),
      ],
    });

    const crawler = new AvbaseCrawler(
      withGateway(new FixtureNetworkClient(new Map<string, unknown>([[searchUrl, searchHtml]]))),
    );

    const response = await crawler.crawl({
      number,
      site: Website.AVBASE,
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("expected failure");
    }

    expect(response.result.failureReason).toBe("not_found");
  });

  it("prefers visible or female cast lists over noisier internal actor arrays", async () => {
    const cases = [
      {
        number: "ABF-777",
        searchUrl: "https://www.avbase.net/works?q=ABF-777",
        detailUrl: "https://www.avbase.net/works/prestige:ABF-777",
        searchHtml: createNextDataHtml({
          works: [
            createSearchWork({
              prefix: "prestige",
              workId: "ABF-777",
              title: "双女優テスト",
              products: [createProduct()],
            }),
          ],
        }),
        detailHtml: createNextDataHtml({
          work: createDetailWork({
            workId: "ABF-777",
            title: "双女優テスト（千咲ちな、別の女优）",
            actors: ["千咲ちな", "別の女优"],
            detailActors: ["千咲ちな", "貞松大輔", "かめじろう"],
            products: [createProduct({ maker: "プレステージ" })],
          }),
        }),
        expectedActors: ["千咲ちな", "別の女优"],
      },
      {
        number: "EBWH-241",
        searchUrl: "https://www.avbase.net/works?q=EBWH-241",
        detailUrl: "https://www.avbase.net/works/ebody:EBWH-241",
        searchHtml: createNextDataHtml({
          works: [
            createSearchWork({
              prefix: "ebody",
              workId: "EBWH-241",
              title: "AVBase DOM actor test",
              products: [createProduct()],
            }),
          ],
        }),
        detailHtml: createNextDataHtml(
          {
            work: createDetailWork({
              workId: "EBWH-241",
              title: "AVBase DOM actor test 千咲ちな",
              actors: [],
              detailActors: ["千咲ちな", "貞松大輔", "かめじろう"],
              products: [createProduct({ maker: "E-BODY" })],
            }),
          },
          `
            <div>
              <div class="text-xs">出演者・メモ</div>
              <div class="m-4">
                <div class="flex flex-wrap gap-2">
                  <a class="chip" href="/talents/%E5%8D%83%E5%92%B2%E3%81%A1%E3%81%AA">
                    <span>千咲ちな</span>
                  </a>
                </div>
              </div>
            </div>
          `,
        ),
        expectedActors: ["千咲ちな"],
      },
    ];

    for (const { number, searchUrl, detailUrl, searchHtml, detailHtml, expectedActors } of cases) {
      const crawler = new AvbaseCrawler(
        withGateway(
          new FixtureNetworkClient(
            new Map<string, unknown>([
              [searchUrl, searchHtml],
              [detailUrl, detailHtml],
            ]),
          ),
        ),
      );

      const response = await crawler.crawl({
        number,
        site: Website.AVBASE,
      });

      expect(response.result.success).toBe(true);
      if (!response.result.success) {
        throw new Error("expected success");
      }

      expect(response.result.data.actors).toEqual(expectedActors);
    }
  });
});
