import { KingdomCrawler } from "@main/services/crawler/sites/kingdom";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

const createSearchHtml = (): string => `
  <html><body>
    <ul class="thum-list">
      <li class="thum-list__item">
        <a class="thum-list__link" href="https://kingdom.vc/products/detail/6331">new arrival</a>
      </li>
    </ul>
    <ol class="ec-topicpath">
      <li class="ec-topicpath__item">「KIDM-1175」の検索結果</li>
    </ol>
    <ul class="ec-shelfGrid">
      <li class="ec-shelfGrid__item">
        <a href="https://kingdom.vc/products/detail/6320">
          <p class="product-thumb-meta__title">LOVE RIP/尾崎ヒカル</p>
        </a>
      </li>
      <li class="ec-shelfGrid__item">
        <a href="https://kingdom.vc/products/detail/6284">
          <p class="product-thumb-meta__title">【先行動画】最高画質HD LOVE RIP/尾崎ヒカル</p>
        </a>
      </li>
    </ul>
    <script>
      eccube.productsClassCategories = {
        "6320": {"__unselected":{"__unselected":{"product_class_id":""}},"__unselected2":{"#":{"product_code":"KIDM-1175"}}},
        "6284": {"__unselected":{"__unselected":{"product_class_id":""}},"9":{"#":{"product_code":"KIDM-1175VHD-6000"}}}
      };
    </script>
  </body></html>
`;

const createDetailHtml = (title: string, productCode: string): string => `
  <html><body>
    <ol class="ec-topicpath">
      <li><a href="https://kingdom.vc/">トップページ</a></li>
      <li><a href="https://kingdom.vc/products/list?category_id=19">レーベル</a></li>
      <li><a href="https://kingdom.vc/products/list?category_id=22">Queen</a></li>
    </ol>
    <h2 class="detail-title">${title}</h2>
    <div class="item_visual">
      <div class="slide-item"><img src="/html/upload/save_image/1175.jpg"></div>
      <div class="slide-item"><img src="/html/upload/save_image/kidm1175.jpg"></div>
    </div>
    <div class="detail-profile__meta__desc">
      <p>熟された身体でファンを魅了する、尾崎ヒカルの最新イメージ。</p>
    </div>
    <div class="table table-product">
      <div class="tr">
        <div class="th">発売日</div>
        <div class="td">2026/03/13</div>
      </div>
      <div class="tr">
        <div class="th">商品番号</div>
        <div class="td"><span class="product-code-default">${productCode}</span></div>
      </div>
      <div class="tr">
        <div class="th">関連カテゴリ</div>
        <div class="td">
          <ul>
            <li>
              <a href="https://kingdom.vc/products/list?category_id=19">レーベル</a>
              <span>＞</span>
              <a href="https://kingdom.vc/products/list?category_id=22">Queen</a>
            </li>
          </ul>
        </div>
      </div>
      <div class="tr">
        <div class="th">女優名</div>
        <div class="td"><a class="link-brown">尾崎ヒカル</a></div>
      </div>
    </div>
  </body></html>
`;

describe("KingdomCrawler", () => {
  it("matches exact product_code from search results and parses the current detail layout", async () => {
    const searchHtml = createSearchHtml();
    const cases = [
      {
        number: "KIDM-1175",
        searchUrl: "https://kingdom.vc/products/list?category_id=&name=KIDM-1175",
        detailUrl: "https://kingdom.vc/products/detail/6320",
        detailHtml: createDetailHtml("LOVE RIP/尾崎ヒカル", "KIDM-1175"),
        expectedTitle: "LOVE RIP",
      },
      {
        number: "KIDM-1175VHD-6000",
        searchUrl: "https://kingdom.vc/products/list?category_id=&name=KIDM-1175VHD-6000",
        detailUrl: "https://kingdom.vc/products/detail/6284",
        detailHtml: createDetailHtml("【先行動画】最高画質HD LOVE RIP/尾崎ヒカル", "KIDM-1175VHD-6000"),
        expectedTitle: "【先行動画】最高画質HD LOVE RIP",
      },
    ];

    for (const { number, searchUrl, detailUrl, detailHtml, expectedTitle } of cases) {
      const fixtures = new Map<string, string>([
        [searchUrl, searchHtml],
        [detailUrl, detailHtml],
      ]);
      const networkClient = new FixtureNetworkClient(fixtures);
      const crawler = new KingdomCrawler(withGateway(networkClient));

      const response = await crawler.crawl({
        number,
        site: Website.KINGDOM,
      });

      expect(response.result.success).toBe(true);
      if (!response.result.success) {
        throw new Error("expected success");
      }

      expect(response.result.data.website).toBe(Website.KINGDOM);
      expect(response.result.data.number).toBe(number);
      expect(response.result.data.title).toBe(expectedTitle);
      expect(response.result.data.actors).toEqual(["尾崎ヒカル"]);
      expect(response.result.data.release_date).toBe("2026-03-13");
      expect(response.result.data.studio).toBe("Kingdom");
      expect(response.result.data.publisher).toBe("Queen");
      expect(response.result.data.plot).toBe("熟された身体でファンを魅了する、尾崎ヒカルの最新イメージ。");
      expect(response.result.data.poster_url).toBe("https://kingdom.vc/html/upload/save_image/1175.jpg");
      expect(response.result.data.thumb_url).toBe("https://kingdom.vc/html/upload/save_image/kidm1175.jpg");
      expect(response.result.data.scene_images).toEqual([]);
      expect(networkClient.requests.map((request) => request.url)).toEqual([searchUrl, detailUrl]);
    }
  });
});
