import { SokmilCrawler } from "@main/services/crawler/sites/sokmil";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

const createSearchHtml = (items: Array<{ href: string; pid: string; title: string; actor: string }>): string => `
  <html><body>
    ${items
      .map(
        (item) => `
          <div class="product" data-pid="${item.pid}">
            <a href="${item.href}">
              <span class="title">${item.title}</span>
            </a>
            <span class="cast">${item.actor}</span>
          </div>
        `,
      )
      .join("")}
  </body></html>
`;

const detailHtml = `
  <html><body>
    <h1>甘えたいカラダ 真田まこと</h1>
    <dl>
      <dt>発売日</dt><dd>2026/03/21</dd>
      <dt>メーカー</dt><dd>ラインコミュニケーションズ</dd>
      <dt>レーベル</dt><dd>Idol Line</dd>
      <dt>出演</dt><dd><a>真田まこと</a></dd>
      <dt>ジャンル</dt><dd><a>アイドル</a><a>イメージ</a></dd>
    </dl>
    <img class="jacket-img" src="https://www.sokmil.com/images/item536132.jpg" />
  </body></html>
`;

const loginHtml = `
  <html class="sk-nonmember">
    <head><title>ログイン - ソクミル</title></head>
    <body>
      <h1>ログイン</h1>
      <form action="/member/login/">
        <input name="login_id" />
        <input type="password" name="password" />
      </form>
    </body>
  </html>
`;

describe("SokmilCrawler", () => {
  it("matches title-plus-actor searches even when filenames use hyphen separators", async () => {
    const searchUrl =
      "https://www.sokmil.com/search/keyword/?sectionid=2&q=%E7%94%98%E3%81%88%E3%81%9F%E3%81%84%E3%82%AB%E3%83%A9%E3%83%80%20%E7%9C%9F%E7%94%B0%E3%81%BE%E3%81%93%E3%81%A8";
    const detailUrl = "https://www.sokmil.com/idol/_item/item536132.htm";
    const fixtures = new Map<string, string>([
      [
        searchUrl,
        createSearchHtml([
          {
            pid: "536132",
            href: `${detailUrl}?ref=search`,
            title: "甘えたいカラダ",
            actor: "真田まこと",
          },
        ]),
      ],
      [detailUrl, detailHtml],
    ]);
    const crawler = new SokmilCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number: "甘えたいカラダ-真田まこと",
      site: Website.SOKMIL,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.title).toBe("甘えたいカラダ 真田まこと");
    expect(response.result.data.actors).toEqual(["真田まこと"]);
  });

  it("matches an exact title from search results instead of guessing the first item", async () => {
    const searchUrl =
      "https://www.sokmil.com/search/keyword/?sectionid=2&q=%E7%94%98%E3%81%88%E3%81%9F%E3%81%84%E3%82%AB%E3%83%A9%E3%83%80%20%E7%9C%9F%E7%94%B0%E3%81%BE%E3%81%93%E3%81%A8";
    const detailUrl = "https://www.sokmil.com/idol/_item/item536132.htm";
    const fixtures = new Map<string, string>([
      [
        searchUrl,
        createSearchHtml([
          {
            pid: "536132",
            href: `${detailUrl}?ref=search`,
            title: "甘えたいカラダ 真田まこと",
            actor: "真田まこと",
          },
        ]),
      ],
      [detailUrl, detailHtml],
    ]);
    const crawler = new SokmilCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number: "甘えたいカラダ 真田まこと",
      site: Website.SOKMIL,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.title).toBe("甘えたいカラダ 真田まこと");
    expect(response.result.data.actors).toEqual(["真田まこと"]);
    expect(response.result.data.release_date).toBe("2026-03-21");
    expect(response.result.data.thumb_url).toBe("https://www.sokmil.com/images/item536132.jpg");
  });

  it("returns not found for actor-only searches with multiple titles", async () => {
    const searchUrl =
      "https://www.sokmil.com/search/keyword/?sectionid=2&q=%E7%9C%9F%E7%94%B0%E3%81%BE%E3%81%93%E3%81%A8";
    const fixtures = new Map<string, string>([
      [
        searchUrl,
        createSearchHtml([
          {
            pid: "536132",
            href: "https://www.sokmil.com/idol/_item/item536132.htm?ref=search",
            title: "甘えたいカラダ 真田まこと",
            actor: "真田まこと",
          },
          {
            pid: "531397",
            href: "https://www.sokmil.com/idol/_item/item531397.htm?ref=search",
            title: "ミルキー・グラマー 真田まこと ＃1",
            actor: "真田まこと",
          },
        ]),
      ],
    ]);
    const crawler = new SokmilCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number: "真田まこと",
      site: Website.SOKMIL,
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("expected failure");
    }

    expect(response.result.failureReason).toBe("not_found");
  });

  it("classifies login-wall search pages instead of reporting not found", async () => {
    const searchUrl =
      "https://www.sokmil.com/search/keyword/?sectionid=2&q=%E7%94%98%E3%81%88%E3%81%9F%E3%81%84%E3%82%AB%E3%83%A9%E3%83%80%20%E7%9C%9F%E7%94%B0%E3%81%BE%E3%81%93%E3%81%A8";
    const fixtures = new Map<string, string>([[searchUrl, loginHtml]]);
    const crawler = new SokmilCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number: "甘えたいカラダ-真田まこと",
      site: Website.SOKMIL,
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("expected failure");
    }

    expect(response.result.failureReason).toBe("login_wall");
    expect(response.result.error).toBe("SOKMIL: login wall");
  });
});
