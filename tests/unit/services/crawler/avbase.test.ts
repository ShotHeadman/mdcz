import { AvbaseCrawler } from "@mdcz/runtime/crawler/sites/avbase";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

const createNextDataHtml = (pageProps: Record<string, unknown>, bodyHtml = ""): string => {
  return `<html><body>${bodyHtml}<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></body></html>`;
};

const createProduct = (options: { maker?: string } = {}) => ({
  maker: options.maker ? { name: options.maker } : undefined,
});

const createSearchWork = (options: { prefix: string; workId: string; title: string }) => ({
  prefix: options.prefix,
  work_id: options.workId,
  title: options.title,
  min_date: "Wed Mar 11 2026 09:00:00 GMT+0900 (Japan Standard Time)",
  actors: [],
  tags: [],
  relworks: { children: [], parents: [] },
  products: [createProduct()],
});

const createDetailWork = (options: {
  workId: string;
  title: string;
  actors?: string[];
  detailActors?: string[];
  products?: Array<{ maker?: { name: string } }>;
}) => ({
  prefix: "",
  work_id: options.workId,
  title: options.title,
  min_date: "Wed Mar 11 2026 09:00:00 GMT+0900 (Japan Standard Time)",
  casts: (options.actors ?? []).map((name) => ({ actor: { name } })),
  actors: (options.detailActors ?? []).map((name) => ({ name })),
  genres: [],
  products: options.products ?? [],
});

describe("AvbaseCrawler", () => {
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
