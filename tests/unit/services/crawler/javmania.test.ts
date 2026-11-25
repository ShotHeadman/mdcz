import { JavManiaCrawler } from "@mdcz/runtime/crawler/sites/javmania";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

const createDetailHtml = (canonicalPath = "/movies/pacopacomama/112426_100/"): string => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: "De-identified title (PacoPacoMama-112426_100)",
    description: "De-identified synopsis",
    url: `https://www.jav-mania.net${canonicalPath}`,
    thumbnailUrl: ["https://www.pacopacomama.com/moviepages/112426_100/images/l_hd.jpg"],
    uploadDate: "2026-11-24T00:00:00+09:00",
    duration: "PT1H40S",
    contentUrl: "https://smovie.pacopacomama.com/sample/movies/112426_100/720p.mp4",
    actor: [{ "@type": "Person", name: "Actor A" }],
    genre: ["Genre A", "Genre B"],
  };

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <link rel="canonical" href="https://www.jav-mania.net${canonicalPath}">
        <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
      </head>
      <body>
        <table class="detail-table"><tbody>
          <tr><th>Site</th><td>PacoPacoMama</td></tr>
          <tr><th>Performer</th><td><a href="/actress/actor-a/">Actor A</a> <span lang="ja">【演員A】</span></td></tr>
        </tbody></table>
        <div class="gallery">
          <div class="gallery__item"><img src="https://www.pacopacomama.com/moviepages/112426_100/images/l_hd.jpg"></div>
          <div class="gallery__item"><img src="https://www.pacopacomama.com/moviepages/112426_100/images/l_thum.jpg"></div>
        </div>
      </body>
    </html>
  `;
};

describe("JavManiaCrawler", () => {
  it("routes studio codes without an official crawler to JAV Mania and parses public fields", async () => {
    const detailUrl = "https://www.jav-mania.net/movies/pacopacomama/112426_100/";
    const networkClient = new FixtureNetworkClient(new Map([[detailUrl, createDetailHtml()]]));
    const crawler = new JavManiaCrawler(withGateway(networkClient));

    const response = await crawler.crawl({ number: "PACO-112426_100", site: Website.JAVMANIA, options: {} });

    expect(networkClient.requests.map((request) => request.url)).toEqual([detailUrl]);
    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error(response.result.error);
    }
    expect(response.result.data).toMatchObject({
      website: Website.JAVMANIA,
      number: "PACO-112426_100",
      title: "De-identified title",
      plot: "De-identified synopsis",
      actors: ["演員A"],
      genres: ["Genre A", "Genre B"],
      studio: "パコパコママ",
      release_date: "2026-11-24",
      durationSeconds: 3640,
      thumb_url: "https://www.pacopacomama.com/moviepages/112426_100/images/l_hd.jpg",
      trailer_url: "https://smovie.pacopacomama.com/sample/movies/112426_100/720p.mp4",
    });
    expect(response.result.data.scene_images).toEqual([
      "https://www.pacopacomama.com/moviepages/112426_100/images/l_thum.jpg",
    ]);
  });

  it.each([
    ["CARIBPR-112426_001", "https://www.jav-mania.net/movies/caribbeanpremium/112426_001/"],
    ["MURA-112126_1276", "https://www.jav-mania.net/movies/muramura/112126_1276/"],
    ["KIN8TENGOKU-4278", "https://www.jav-mania.net/movies/kin8/4278/"],
    ["NYOSHIN-LES001", "https://www.jav-mania.net/movies/nyoshin/les001/"],
    ["C0930-HITOZUMA0051", "https://www.jav-mania.net/movies/c0930/hitozuma0051/"],
    ["AV9898-100", "https://www.jav-mania.net/movies/av9898/100/"],
    ["KIN84278", "https://www.jav-mania.net/movies/kin8/4278/"],
  ])("requests the release page for %s", async (number, detailUrl) => {
    const canonicalPath = new URL(detailUrl).pathname;
    const networkClient = new FixtureNetworkClient(new Map([[detailUrl, createDetailHtml(canonicalPath)]]));
    const crawler = new JavManiaCrawler(withGateway(networkClient));

    const response = await crawler.crawl({ number, site: Website.JAVMANIA, options: {} });

    expect(networkClient.requests.map((request) => request.url)).toEqual([detailUrl]);
    expect(response.result.success).toBe(true);
  });

  it("rejects a page whose canonical URL belongs to another release", async () => {
    const detailUrl = "https://www.jav-mania.net/movies/pacopacomama/112426_100/";
    const networkClient = new FixtureNetworkClient(
      new Map([[detailUrl, createDetailHtml("/movies/1pondo/112426_100/")]]),
    );
    const crawler = new JavManiaCrawler(withGateway(networkClient));

    const response = await crawler.crawl({ number: "PACO-112426_100", site: Website.JAVMANIA, options: {} });

    expect(response.result.success).toBe(false);
  });

  it("rejects a page whose VideoObject describes another release", async () => {
    const detailUrl = "https://www.jav-mania.net/movies/pacopacomama/112426_100/";
    const html = createDetailHtml().replace(
      '"url":"https://www.jav-mania.net/movies/pacopacomama/112426_100/"',
      '"url":"https://www.jav-mania.net/movies/pacopacomama/112426_101/"',
    );
    const networkClient = new FixtureNetworkClient(new Map([[detailUrl, html]]));
    const crawler = new JavManiaCrawler(withGateway(networkClient));

    const response = await crawler.crawl({ number: "PACO-112426_100", site: Website.JAVMANIA, options: {} });

    expect(response.result.success).toBe(false);
  });

  it("accepts a language-prefixed manual detail URL for the same release", async () => {
    const detailUrl = "https://www.jav-mania.net/ja/movies/pacopacomama/112426_100";
    const networkClient = new FixtureNetworkClient(
      new Map([[detailUrl, createDetailHtml("/ja/movies/pacopacomama/112426_100")]]),
    );
    const crawler = new JavManiaCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "PACO-112426_100",
      site: Website.JAVMANIA,
      options: { detailUrl },
    });

    expect(response.result.success).toBe(true);
  });

  it("accepts a manual detail URL for the same release", async () => {
    const detailUrl = "https://www.jav-mania.net/movies/pacopacomama/112426_100/";
    const networkClient = new FixtureNetworkClient(new Map([[detailUrl, createDetailHtml()]]));
    const crawler = new JavManiaCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "PACO-112426_100",
      site: Website.JAVMANIA,
      options: { detailUrl },
    });

    expect(response.result.success).toBe(true);
  });

  it("serves only the studio codes it covers", () => {
    for (const number of ["PACO-112426_100", "CARIBPR-112426_001", "HGMO-6608", "PIKKUR-04727", "NYOSHIN-N3424"]) {
      expect(JavManiaCrawler.numberPattern.test(number)).toBe(true);
    }
    // Bare n#### is also Tokyo-Hot's format, and official crawlers already serve these studios.
    for (const number of ["N3424", "1PON-112326_001", "CARIB-112426-001", "HEYZO-3970", "SSIS-001"]) {
      expect(JavManiaCrawler.numberPattern.test(number)).toBe(false);
    }
  });
});
