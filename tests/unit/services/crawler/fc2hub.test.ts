import { Fc2HubCrawler } from "@main/services/crawler/sites/fc2hub";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("Fc2HubCrawler", () => {
  it("parses a direct-hit detail page from canonical metadata", async () => {
    const searchUrl = "https://javten.com/search?kw=4327962";
    const detailUrl = "https://javten.com/video/1822734/id4327962/white-peach";
    const html = `
      <html>
        <head>
          <link rel="canonical" href="${detailUrl}" />
          <meta property="og:url" content="http://javten.com/video/1822734/id4327962/white-peach" />
          <meta property="og:image" content="https://storage91000.contents.fc2.com/file/379/37822399/1709274241.74.jpg" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Movie",
              "name": "White Peach/白咲ももな",
              "description": "白咲ももなちゃんのデビュー作品です。",
              "image": "https://storage91000.contents.fc2.com/file/379/37822399/1709274241.74.jpg",
              "identifier": ["FC2-PPV-4327962", "FC2-4327962", "4327962"],
              "datePublished": "2024/03/01",
              "duration": "PT1H20M1S",
              "actor": [],
              "genre": ["fuck"],
              "director": "DIVA's Entertainment",
              "aggregateRating": { "ratingValue": 5 }
            }
          </script>
        </head>
        <body>
          <h1 class="card-title fc2-id">FC2-PPV-4327962</h1>
          <h1 class="card-text fc2-title">White Peach/白咲ももな</h1>
          <p class="card-text">タグ :
            <a class="badge badge-primary">fuck</a>
          </p>
          <div class="row">
            <div class="col des">
              <p>白咲ももなちゃんのデビュー作品になります！</p>
            </div>
          </div>
          <div class="card">
            <div class="card-header">売り手情報</div>
            <div class="card-body">
              <div class="row">
                <div class="col-8">DIVA&#039;s Entertainment</div>
              </div>
            </div>
          </div>
          <a data-fancybox="gallery" href="https://storage91000.contents.fc2.com/file/379/37822399/1709274245.14.jpg">1</a>
          <a data-fancybox="gallery" href="https://storage91000.contents.fc2.com/file/379/37822399/1709274246.71.jpg">2</a>
        </body>
      </html>
    `;

    const fixtures = new Map<string, string>([
      [searchUrl, html],
      [detailUrl, html],
    ]);
    const networkClient = new FixtureNetworkClient(fixtures);
    const crawler = new Fc2HubCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "FC2-4327962",
      site: Website.FC2HUB,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.website).toBe(Website.FC2HUB);
    expect(response.result.data.number).toBe("FC2-4327962");
    expect(response.result.data.title).toBe("White Peach/白咲ももな");
    expect(response.result.data.studio).toBe("DIVA's Entertainment");
    expect(response.result.data.publisher).toBe("DIVA's Entertainment");
    expect(response.result.data.actors).toEqual([]);
    expect(response.result.data.genres).toEqual(["fuck"]);
    expect(response.result.data.release_date).toBe("2024-03-01");
    expect(response.result.data.durationSeconds).toBe(4801);
    expect(response.result.data.rating).toBe(5);
    expect(response.result.data.thumb_url).toBe(
      "https://storage91000.contents.fc2.com/file/379/37822399/1709274241.74.jpg",
    );
    expect(response.result.data.poster_url).toBe(
      "https://storage91000.contents.fc2.com/file/379/37822399/1709274241.74.jpg",
    );
    expect(response.result.data.scene_images).toEqual([
      "https://storage91000.contents.fc2.com/file/379/37822399/1709274245.14.jpg",
      "https://storage91000.contents.fc2.com/file/379/37822399/1709274246.71.jpg",
    ]);
    expect(networkClient.requests.map((request) => request.url)).toEqual([searchUrl]);
  });

  it("falls back to parsing actor names from the description block", async () => {
    const searchUrl = "https://javten.com/search?kw=4515706";
    const detailUrl = "https://javten.com/video/1848667/id4515706/yuuna";
    const html = `
      <html>
        <head>
          <link rel="canonical" href="${detailUrl}" />
          <meta property="og:image" content="https://storage100000.contents.fc2.com/file/395/39442229/1723209173.51.png" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Movie",
              "name": "ゆうな再会",
              "description": "ゆうなちゃんとの再会作品です。",
              "image": "https://storage100000.contents.fc2.com/file/395/39442229/1723209173.51.png",
              "identifier": ["FC2-PPV-4515706", "4515706"],
              "datePublished": "2024/08/10",
              "duration": "PT2H14M28S",
              "actor": [],
              "genre": [],
              "director": "千本桜",
              "aggregateRating": { "ratingValue": 4.7 }
            }
          </script>
        </head>
        <body>
          <h1 class="card-title fc2-id">FC2-PPV-4515706</h1>
          <h1 class="card-text fc2-title">ゆうな再会</h1>
          <div class="row">
            <div class="col des">
              <p>過去の二作で大ヒットを記録したあの美少女との奇跡の再会！</p><br>
              ■商品内容<br>
              本編４分割高画質<br>
              ■出演<br>
              名前　ゆうな<br>
              年齢　１９歳<br>
              職業　女○○生<br>
            </div>
          </div>
          <div class="card">
            <div class="card-header">売り手情報</div>
            <div class="card-body">
              <div class="row">
                <div class="col-8">千本桜</div>
              </div>
            </div>
          </div>
          <a data-fancybox="gallery" href="//contents-thumbnail2.fc2.com/w780/storage100000.contents.fc2.com/file/395/39442229/1723209178.04.png">1</a>
        </body>
      </html>
    `;

    const fixtures = new Map<string, string>([
      [searchUrl, html],
      [detailUrl, html],
    ]);
    const crawler = new Fc2HubCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number: "FC2-4515706",
      site: Website.FC2HUB,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.actors).toEqual(["ゆうな"]);
    expect(response.result.data.studio).toBe("千本桜");
    expect(response.result.data.release_date).toBe("2024-08-10");
    expect(response.result.data.durationSeconds).toBe(8068);
    expect(response.result.data.scene_images).toEqual([
      "https://contents-thumbnail2.fc2.com/w780/storage100000.contents.fc2.com/file/395/39442229/1723209178.04.png",
    ]);
  });

  it("falls back to a search-result link when the search page does not redirect", async () => {
    const searchUrl = "https://javten.com/search?kw=4327962";
    const detailUrl = "https://javten.com/video/1822734/id4327962/white-peach";
    const searchHtml = `
      <html>
        <head>
          <link rel="canonical" href="${searchUrl}" />
        </head>
        <body>
          <a href="/video/1822734/id4327962/white-peach">FC2-PPV-4327962</a>
        </body>
      </html>
    `;
    const detailHtml = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Movie",
              "name": "White Peach/白咲ももな",
              "identifier": ["4327962"],
              "datePublished": "2024/03/01"
            }
          </script>
        </head>
        <body>
          <h1 class="card-text fc2-title">White Peach/白咲ももな</h1>
        </body>
      </html>
    `;

    const fixtures = new Map<string, string>([
      [searchUrl, searchHtml],
      [detailUrl, detailHtml],
    ]);
    const crawler = new Fc2HubCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number: "FC2-4327962",
      site: Website.FC2HUB,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.number).toBe("FC2-4327962");
    expect(response.result.data.title).toBe("White Peach/白咲ももな");
  });
});
