import { H0930Crawler } from "@mdcz/runtime/crawler/sites/h0930";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

const createDetailHtml = (): string => {
  const jsonLd = {
    "@context": "http://schema.org",
    "@type": "Movie",
    name: "H0930 Sample Title",
    image: "//www.h0930.com/moviepages/gol205/images/movie.jpg",
    actor: {
      "@type": "Person",
      name: "Actor A",
      image: "//www.h0930.com/moviepages/gol205/images/thumb_s.jpg",
    },
    description: "Sample plot from JSON-LD",
    duration: "PT01H07M30S",
    dateCreated: "2024-03-16T00:00:00+09:00",
    video: {
      "@type": "VideoObject",
      contentUrl: "https://smovie.h0930.com/moviepages/gol205/sample.mp4",
      duration: "PT01H07M30S",
      name: "H0930 Sample Title",
      provider: "H0930",
      thumbnail: "//www.h0930.com/moviepages/gol205/images/movie.jpg",
      uploadDate: "2024-03-16T00:00:00+09:00",
    },
  };

  return `
    <!doctype html>
    <html lang="ja">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <meta name="keywords" content="0930, Sample Genre, Long Tail">
        <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
      </head>
      <body class="moviepage">
        <div class="moviePlay_title"><h1>Fallback Title</h1></div>
        <video poster="https://www.h0930.com/moviepages/gol205/images/movie.jpg">
          <source src="https://smovie.h0930.com/moviepages/gol205/sample.mp4">
        </video>
        <script>
          document.write('<a href="https://members.h0930.com/gold/moviepages/gol205/images/g_b001.jpg"><img src="https://members.h0930.com/gold/moviepages/gol205/images/g_s001.jpg"></a>');
          document.write('<div><img src="https://www.h0930.com/moviepages/gol205/images/g_s001.jpg"></div>');
          document.write('<a href="https://www.h0930.com/moviepages/gol205/images/g_b002.jpg"><img src="https://www.h0930.com/moviepages/gol205/images/g_s002.jpg"></a>');
        </script>
      </body>
    </html>
  `;
};

describe("H0930Crawler", () => {
  it("maps H0930 numbers to exact detail pages and parses public metadata", async () => {
    const networkClient = new FixtureNetworkClient(
      new Map<string, unknown>([["https://www.h0930.com/moviepages/gol205/index.html", createDetailHtml()]]),
    );
    const crawler = new H0930Crawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "H0930-GOL205",
      site: Website.H0930,
      options: {},
    });

    expect(networkClient.requests.map((request) => request.url)).toEqual([
      "https://www.h0930.com/moviepages/gol205/index.html",
    ]);
    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }

    expect(response.result.data).toMatchObject({
      website: Website.H0930,
      number: "H0930-GOL205",
      title: "H0930 Sample Title",
      plot: "Sample plot from JSON-LD",
      actors: ["Actor A"],
      genres: ["0930", "Sample Genre", "Long Tail"],
      studio: "H0930",
      publisher: "H0930",
      release_date: "2024-03-16",
      durationSeconds: 4050,
      thumb_url: "https://www.h0930.com/moviepages/gol205/images/movie.jpg",
      poster_url: "https://www.h0930.com/moviepages/gol205/images/movie.jpg",
      trailer_url: "https://smovie.h0930.com/moviepages/gol205/sample.mp4",
    });
    expect(response.result.data.scene_images).toEqual([
      "https://www.h0930.com/moviepages/gol205/images/g_s001.jpg",
      "https://www.h0930.com/moviepages/gol205/images/g_b002.jpg",
      "https://www.h0930.com/moviepages/gol205/images/g_s002.jpg",
    ]);
  });

  it("validates the movie identity on manual detail URLs", async () => {
    const networkClient = new FixtureNetworkClient(
      new Map<string, unknown>([["https://www.h0930.com/moviepages/gol205/index.html", createDetailHtml()]]),
    );
    const crawler = new H0930Crawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "H0930-GOL205",
      site: Website.H0930,
      options: {
        detailUrl: "https://www.h0930.com/moviepages/gol205/index.html",
      },
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }

    expect(response.result.data.number).toBe("H0930-GOL205");
    const mismatch = await crawler.crawl({
      number: "H0930-GOL206",
      site: Website.H0930,
      options: { detailUrl: "https://www.h0930.com/moviepages/gol205/index.html" },
    });
    expect(mismatch.result).toMatchObject({ success: false, reason: "not_found" });
  });

  it("returns a normal crawler failure for unparseable pages", async () => {
    const networkClient = new FixtureNetworkClient(
      new Map<string, unknown>([
        ["https://www.h0930.com/moviepages/missing/index.html", "<html><body>404</body></html>"],
      ]),
    );
    const crawler = new H0930Crawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "missing",
      site: Website.H0930,
      options: {},
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("Expected H0930 crawl to fail");
    }

    expect(response.result.reason).toBe("not_found");
    expect(response.result.error).toContain("Detail URL not found");
  });
});
