import { H4610Crawler } from "@mdcz/runtime/crawler/sites/h4610";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

const createDetailHtml = (): string => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: "De-identified H4610 title",
    image: "//www.h4610.com/moviepages/ori696/images/movie.jpg",
    actor: [{ "@type": "Person", name: "Actor A" }],
    description: "De-identified synopsis",
    duration: "PT01H07M30S",
    dateCreated: "2024-03-16T00:00:00+09:00",
    video: {
      "@type": "VideoObject",
      contentUrl: "https://smovie.h4610.com/moviepages/ori696/sample.mp4",
      provider: "H4610",
      thumbnail: "//www.h4610.com/moviepages/ori696/images/movie.jpg",
    },
  };

  return `
    <!doctype html>
    <html lang="ja">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <meta name="keywords" content="H4610, Sample Genre">
        <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
      </head>
      <body>
        <script>
          document.write('<img src="https://www.h4610.com/moviepages/ori696/images/g_s001.jpg">');
          document.write('<img src="https://www.h0930.com/moviepages/ori696/images/g_s002.jpg">');
        </script>
      </body>
    </html>
  `;
};

describe("H4610Crawler", () => {
  it("routes H4610 numbers to official detail pages and parses public fields", async () => {
    const detailUrl = "https://www.h4610.com/moviepages/ori696/index.html";
    const networkClient = new FixtureNetworkClient(new Map([[detailUrl, createDetailHtml()]]));
    const crawler = new H4610Crawler(withGateway(networkClient));

    const response = await crawler.crawl({ number: "h4610_ori696", site: Website.H4610, options: {} });

    expect(networkClient.requests.map((request) => request.url)).toEqual([detailUrl]);
    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }

    expect(response.result.data).toMatchObject({
      website: Website.H4610,
      number: "H4610-ORI696",
      title: "De-identified H4610 title",
      plot: "De-identified synopsis",
      actors: ["Actor A"],
      genres: ["H4610", "Sample Genre"],
      studio: "H4610",
      publisher: "H4610",
      release_date: "2024-03-16",
      durationSeconds: 4050,
      thumb_url: "https://www.h4610.com/moviepages/ori696/images/movie.jpg",
      poster_url: "https://www.h4610.com/moviepages/ori696/images/movie.jpg",
      trailer_url: "https://smovie.h4610.com/moviepages/ori696/sample.mp4",
    });
    expect(response.result.data.scene_images).toEqual(["https://www.h4610.com/moviepages/ori696/images/g_s001.jpg"]);
  });

  it("accepts an official manual detail URL and keeps the H4610 prefix", async () => {
    const detailUrl = "https://www.h4610.com/moviepages/ori641/index.html";
    const networkClient = new FixtureNetworkClient(
      new Map([[detailUrl, createDetailHtml().replaceAll("ori696", "ori641")]]),
    );
    const crawler = new H4610Crawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "ignored",
      site: Website.H4610,
      options: { detailUrl },
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }
    expect(response.result.data.number).toBe("H4610-ORI641");
  });
});
