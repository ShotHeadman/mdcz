import { FantiaCrawler } from "@mdcz/runtime/crawler/sites/fantia";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("FantiaCrawler", () => {
  it("parses product pages correctly", async () => {
    const cases = [
      {
        number: "1035215",
        searchUrl: "https://fantia.jp/products/1035215",
        searchHtml: `
          <html><head>
            <title>title of 1035215 | fantia</title>
            <meta property="og:image" content="https://c.fantia.jp/uploads/product/image/1035215/blurred_ogp_76b94de1-c692-457f-945a-27b8ee248532.jpg" />
            <script
              type="application/ld+json">[{"@type":"Product","@context":"https://schema.org","name":"name of 1035215","description":"description of 1035215","uploadDate":"2024-01-15","image":["https://c.fantia.jp/uploads/product/image/1035215/76b94de1-c692-457f-945a-27b8ee248532.jpg","https://c.fantia.jp/uploads/product_image/file/916294/micro_3a276866_Frame_93.jpg","https://c.fantia.jp/uploads/product_image/file/916295/micro_88a0cef4_Frame_87.jpg","https://c.fantia.jp/uploads/product_image/file/916296/micro_25beb2e3_Frame_88.jpg"],"brand":{"@type":"Brand","name":"hakuのファンティア"},"offers":{"@type":"Offer","price":400,"priceCurrency":"JPY","url":"https://fantia.jp/products/1035215","availability":"https://schema.org/InStock"}}]</script>
          </head><body>
            <script class="gtm-json"
              type="application/ld+json">{"fanclub_id":501856,"fanclub_brand":"男性向け","fanclub_category":"漫画","fanclub_name":"fanclub_name of 1035215","fanclub_user_name":"fanclub_user_name of 1035215","content_title":"content title of 1035215","content_type":"product","content_id":1035215}</script>
            <div class="product-gallery-item"><img class="img-fluid lazyload " alt="title of 1035215"
                src="/uploads/product_image/file/916294/main_3a276866_Frame_93.jpeg?size=large"></div>
            <div class="product-gallery-item"><img class="img-fluid lazyload " alt="title of 1035215"
                data-src="/uploads/product_image/file/916295/main_88a0cef4_Frame_87.png"></div>
            <div class="product-gallery-item"><img class="img-fluid lazyload " alt="title of 1035215"
                src="https://c.fantia.jp/uploads/product_image/file/916296/main_25beb2e3_Frame_88.webp"></div>
            </div>
            <div class="product-description"></div>
            <h1 class="product-title mb-20">title of 1035215</h1>
          </body></html>
        `,
        assert: (data: Awaited<ReturnType<FantiaCrawler["crawl"]>>) => {
          if (!data.result.success) throw new Error("expected success");
          expect(data.result.data.website).toBe(Website.FANTIA);
          expect(data.result.data.number).toBe("1035215");
          expect(data.result.data.title).toBe("title of 1035215");
          expect(data.result.data.actors).toEqual([]);
          expect(data.result.data.genres).toEqual(["漫画"]);
          expect(data.result.data.publisher).toBe("fanclub_name of 1035215");
          expect(data.result.data.release_date).toBe("2024-01-15");
          expect(data.result.data.thumb_url).toBe(
            "https://c.fantia.jp/uploads/product/image/1035215/main_76b94de1-c692-457f-945a-27b8ee248532.jpg",
          );
          expect(data.result.data.plot).toBe("description of 1035215");
          expect(data.result.data.scene_images).toEqual([
            "https://c.fantia.jp/uploads/product/image/1035215/main_76b94de1-c692-457f-945a-27b8ee248532.jpg",
            "https://fantia.jp/uploads/product_image/file/916294/main_3a276866_Frame_93.jpeg?size=large",
            "https://fantia.jp/uploads/product_image/file/916295/main_88a0cef4_Frame_87.png",
            "https://c.fantia.jp/uploads/product_image/file/916296/main_25beb2e3_Frame_88.webp",
          ]);
        },
      },
    ];

    for (const { number, searchUrl, searchHtml, assert } of cases) {
      const fixtures = new Map<string, string>([[searchUrl, searchHtml]]);
      const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

      const response = await crawler.crawl({ number, site: Website.FANTIA });

      expect(response.result.success).toBe(true);
      assert(response as Awaited<ReturnType<FantiaCrawler["crawl"]>>);
    }
  });

  it("enriches manual post URLs with API data without serializing it into HTML", async () => {
    const number = "4155703";
    const searchUrl = "https://fantia.jp/posts/4155703";
    const apiUrl = "https://fantia.jp/api/v1/posts/4155703";

    const searchHtml = `
      <html><head>
        <title>title of 4155703</title>
        <meta name="csrf-token"
          content="test-csrf-token">
        <meta property="og:image" content="https://c.fantia.jp/uploads/post/file/4155703/blurred_ogp_ff86c9f5-8755-4f59-b67a-be3e7d826a1f.jpg" />
        <script
          type="application/ld+json">{"@type":"Article","@context":"https://schema.org","datePublished":"2026-07-21T19:36:00+09:00","dateModified":"2026-07-21T19:36:36+09:00","headline":"headline of 4155703","description":"description of 4155703","mainEntityOfPage":"https://fantia.jp/posts/4155703","image":"https://c.fantia.jp/uploads/fanclub/icon_image/491009/thumb_fa862b71-4ce8-4aac-be56-270ad182c150.png","author":{"@type":"Person","name":"name of 4155703","url":"https://fantia.jp/fanclubs/491009","sameAs":["https://x.com/rena_hlive","https://www.youtube.com/@renachankapaana","https://nicochannel.jp/renahliveasmr/","https://lit.link/renabesuteahlive"]},"publisher":{"@type":"Organization","name":"name of 4155703","logo":{"@type":"ImageObject","url":"https://fantia.jp/assets/customers/ogp-a43eda907aaba5783458b8036f8e5873e4b07a4284f778612809580dcd28353e.jpg"}}}</script>
      </head><body>
        <script class="gtm-json"
          type="application/ld+json">{"fanclub_id":491009,"fanclub_brand":"男性向け","fanclub_category":"VTuber","fanclub_name":"fanclub_name of 4155703","fanclub_user_name":"fanclub_user_name of 4155703","content_title":"content title of 4155703","content_type":"post","content_id":4155703,"tag":["vtuber声優","ASMR"]}</script>
      </body></html>
    `;

    const apiResponse = {
      post: {
        comment: "Full post body text </div> with complete content that is not truncated.",
        blog_comment: JSON.stringify({
          ops: [
            { insert: "Some text\n" },
            { insert: { fantiaImage: { url: "https://cc.fantia.jp/uploads/album_image/file/1/main_image1.jpg" } } },
            { insert: "More text\n" },
            { insert: { fantiaImage: { url: "https://cc.fantia.jp/uploads/album_image/file/2/main_image2.jpg" } } },
          ],
        }),
        post_contents: [
          {
            visible_status: "visible",
            post_content_photos: [
              {
                url: {
                  thumb: "https://cc.fantia.jp/uploads/post_content_photo/file/3/thumb_image3.png",
                  main: "https://cc.fantia.jp/uploads/post_content_photo/file/3/main_image3.png",
                  original: "https://cc.fantia.jp/uploads/post_content_photo/file/3/image3.png",
                },
              },
              { url: "https://cc.fantia.jp/uploads/album_image/file/2/main_image2.jpg" },
            ],
          },
          {
            visible_status: "uncatchable",
            post_content_photos: [
              { url: { main: "https://cc.fantia.jp/uploads/post_content_photo/file/4/locked_image4.png" } },
            ],
          },
        ],
      },
    };

    const fixtures = new Map<string, unknown>([
      [searchUrl, searchHtml],
      [apiUrl, apiResponse],
    ]);
    const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({ number, site: Website.FANTIA, options: { detailUrl: searchUrl } });

    expect(response.result.success).toBe(true);
    if (!response.result.success) throw new Error("expected success");

    expect(response.result.data.website).toBe(Website.FANTIA);
    expect(response.result.data.number).toBe("4155703");
    expect(response.result.data.title).toBe("headline of 4155703");
    expect(response.result.data.actors).toEqual([]);
    expect(response.result.data.genres).toEqual(["vtuber声優", "ASMR", "VTuber"]);
    expect(response.result.data.publisher).toBe("fanclub_name of 4155703");
    expect(response.result.data.release_date).toBe("2026-07-21");
    expect(response.result.data.thumb_url).toBe(
      "https://c.fantia.jp/uploads/post/file/4155703/main_ff86c9f5-8755-4f59-b67a-be3e7d826a1f.jpg",
    );

    expect(response.result.data.plot).toBe("Full post body text </div> with complete content that is not truncated.");

    // scene_images from blog_comment fantiaImage entries
    expect(response.result.data.scene_images).toEqual([
      "https://cc.fantia.jp/uploads/album_image/file/1/main_image1.jpg",
      "https://cc.fantia.jp/uploads/album_image/file/2/main_image2.jpg",
      "https://cc.fantia.jp/uploads/post_content_photo/file/3/main_image3.png",
    ]);
  });

  it("falls back to JSON-LD data when API injection fails for posts", async () => {
    const number = "4155703";
    const searchUrl = "https://fantia.jp/posts/4155703";

    const searchHtml = `
      <html><head>
        <title>title of 4155703</title>
        <meta name="csrf-token"
          content="test-csrf-token">
        <meta property="og:image" content="https://c.fantia.jp/uploads/post/file/4155703/blurred_ogp_ff86c9f5-8755-4f59-b67a-be3e7d826a1f.jpg" />
        <script
          type="application/ld+json">{"@type":"Article","@context":"https://schema.org","datePublished":"2026-07-21T19:36:00+09:00","dateModified":"2026-07-21T19:36:36+09:00","headline":"headline of 4155703","description":"description of 4155703","mainEntityOfPage":"https://fantia.jp/posts/4155703","image":"https://c.fantia.jp/uploads/fanclub/icon_image/491009/thumb_fa862b71-4ce8-4aac-be56-270ad182c150.png","author":{"@type":"Person","name":"name of 4155703","url":"https://fantia.jp/fanclubs/491009","sameAs":["https://x.com/rena_hlive","https://www.youtube.com/@renachankapaana","https://nicochannel.jp/renahliveasmr/","https://lit.link/renabesuteahlive"]},"publisher":{"@type":"Organization","name":"name of 4155703","logo":{"@type":"ImageObject","url":"https://fantia.jp/assets/customers/ogp-a43eda907aaba5783458b8036f8e5873e4b07a4284f778612809580dcd28353e.jpg"}}}</script>
      </head><body>
        <script class="gtm-json"
          type="application/ld+json">{"fanclub_id":491009,"fanclub_brand":"男性向け","fanclub_category":"VTuber","fanclub_name":"fanclub_name of 4155703","fanclub_user_name":"fanclub_user_name of 4155703","content_title":"content title of 4155703","content_type":"post","content_id":4155703,"tag":["vtuber声優","ASMR"]}</script>
      </body></html>
    `;

    const fixtures = new Map<string, string>([[searchUrl, searchHtml]]);
    const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({ number, site: Website.FANTIA });

    expect(response.result.success).toBe(true);
    if (!response.result.success) throw new Error("expected success");

    // Falls back to JSON-LD description (truncated)
    expect(response.result.data.plot).toBe("description of 4155703");

    // Falls back to thumb-only scene_images
    expect(response.result.data.scene_images).toEqual([
      "https://c.fantia.jp/uploads/post/file/4155703/main_ff86c9f5-8755-4f59-b67a-be3e7d826a1f.jpg",
    ]);
  });

  it("returns an explicit error when Fantia serves the age verification page", async () => {
    const number = "99999";
    const productsUrl = "https://fantia.jp/products/99999";

    const ageVerifyHtml = `
      <html><head><title>Fantia</title></head><body>
        <div class="list-group-item-title">あなたは18歳以上ですか？</div>
      </body></html>
    `;

    const fixtures = new Map<string, string>([[productsUrl, ageVerifyHtml]]);
    const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({ number, site: Website.FANTIA });

    expect(response.result.success).toBe(false);
    if (response.result.success) throw new Error("expected failure");
    expect(response.result.error).toContain("age verification");
  });

  it("selects the exact Fantia search result instead of the first result", async () => {
    const number = "12345";
    const searchUrl = "https://fantia.jp/products?brand_type=0&category=&keyword=12345";
    const detailUrl = "https://fantia.jp/products/12345";
    const detailHtml = `
      <html><head>
        <meta property="og:image" content="https://c.fantia.jp/uploads/product/image/12345/blurred_ogp_main.jpg" />
      </head><body>
        <script type="application/ld+json">{"fanclub_name":"Test club"}</script>
        <h1 class="product-title mb-20">Correct result</h1>
        <div class="product-description">Correct description</div>
      </body></html>
    `;
    const fixtures = new Map<string, string>([
      [
        searchUrl,
        '<html><head><title>Fantia search</title></head><body><a class="link-block" href="/products/99999"></a><a class="link-block" href="/products/12345"></a></body></html>',
      ],
      [detailUrl, detailHtml],
    ]);
    const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({ number, site: Website.FANTIA });

    expect(response.result).toMatchObject({ success: true, data: { title: "Correct result", number } });
  });

  it("rejects localized search pages returned for a direct detail URL", async () => {
    const number = "12345";
    const postsUrl = "https://fantia.jp/posts/12345";
    const productsUrl = "https://fantia.jp/products/12345";
    const productsHtml = `
      <html><head>
        <title>Correct product</title>
        <meta property="og:image" content="https://c.fantia.jp/uploads/product/image/12345/blurred_ogp_main.jpg" />
      </head><body>
        <script type="application/ld+json">{
          "fanclub_name":"Test club",
          "content_type":"product",
          "content_id":12345
        }</script>
        <h1 class="product-title mb-20">Correct product</h1>
      </body></html>
    `;
    const fixtures = new Map<string, string>([
      [
        postsUrl,
        '<html><head><title>投稿搜索 | Fantia</title><meta property="og:image" content="https://fantia.jp/search.png" /></head></html>',
      ],
      [productsUrl, productsHtml],
    ]);
    const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({ number, site: Website.FANTIA });

    expect(response.result).toMatchObject({ success: true, data: { title: "Correct product", number } });
  });

  it("returns an error when neither products nor posts URL resolves", async () => {
    const number = "00000";
    const fixtures = new Map<string, string>([]);
    const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({ number, site: Website.FANTIA });

    expect(response.result.success).toBe(false);
    if (response.result.success) throw new Error("expected failure");
    expect(response.result.failureReason).toBe("not_found");
  });
});
