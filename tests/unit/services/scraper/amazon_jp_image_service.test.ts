import type { NetworkClient, NetworkSession } from "@main/services/network";
import { AmazonJpImageService } from "@main/services/scraper/AmazonJpImageService";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { describe, expect, it, vi } from "vitest";

const baseCrawlerData: CrawlerData = {
  title: "原題",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: [],
  sample_images: [],
  website: Website.JAVDB,
  poster_url: "https://javdb.com/poster.jpg",
};

class FakeNetworkClient {
  readonly sessionUrls: string[] = [];
  readonly head = vi.fn(async (url: string) => ({
    status: this.reachable.has(url) ? 200 : 404,
    ok: this.reachable.has(url),
  }));

  constructor(
    private readonly searchHtml: string,
    private readonly detailHtmlByPath: Map<string, string>,
    private readonly reachable: Set<string>,
  ) {}

  createSession(): NetworkSession {
    return {
      getText: vi.fn(async (url: string) => {
        this.sessionUrls.push(url);
        if (url.includes("/black-curtain/save-eligibility/black-curtain")) {
          return this.searchHtml;
        }

        const path = new URL(url).pathname;
        const html = this.detailHtmlByPath.get(path);
        if (html === undefined) {
          throw new Error(`Unexpected URL: ${url}`);
        }
        return html;
      }),
    };
  }
}

const extractKeywordFromSearchUrl = (url: string): string => {
  const returnUrl = new URL(url).searchParams.get("returnUrl") ?? "";
  const query = returnUrl.includes("?") ? returnUrl.slice(returnUrl.indexOf("?") + 1) : "";
  const keyword = new URLSearchParams(query).get("k") ?? "";
  return decodeURIComponent(keyword).replace(/\+/gu, " ");
};

describe("AmazonJpImageService", () => {
  it("uses the raw title as the only search keyword", async () => {
    const rawTitle = "【限定】生のタイトル [DVD]";
    const imageUrl = "https://m.media-amazon.com/images/I/81raw._AC_SL1500_.jpg";
    const networkClient = new FakeNetworkClient(
      `
        <div data-component-type="s-search-result" data-asin="B000TEST01">
          <h2><a href="/dp/B000TEST01"><span>${rawTitle}</span></a></h2>
        </div>
      `,
      new Map([
        [
          "/dp/B000TEST01",
          `
            <div id="leftCol">
              <div id="imageBlock">
                <img src="${imageUrl}" />
              </div>
            </div>
          `,
        ],
      ]),
      new Set([imageUrl]),
    );
    const service = new AmazonJpImageService(networkClient as unknown as NetworkClient);

    const result = await service.enhance(
      {
        ...baseCrawlerData,
        title: rawTitle,
        actors: ["Actor A", "Actor B"],
      },
      Website.JAVDB,
    );

    expect(result).toEqual({
      poster_url: imageUrl,
      upgraded: true,
      reason: "已升级为Amazon商品海报",
    });
    expect(extractKeywordFromSearchUrl(networkClient.sessionUrls[0])).toBe(rawTitle);
    expect(networkClient.sessionUrls[0]).not.toContain("Actor");
  });

  it("returns no result when the search page is empty", async () => {
    const networkClient = new FakeNetworkClient('<div class="s-no-results">empty</div>', new Map(), new Set());
    const service = new AmazonJpImageService(networkClient as unknown as NetworkClient);

    const result = await service.enhance(baseCrawlerData, Website.JAVDB);

    expect(result).toEqual({
      upgraded: false,
      reason: "搜索无结果",
    });
    expect(networkClient.head).not.toHaveBeenCalled();
  });

  it("prefers the largest dynamic image candidate when src is missing", async () => {
    const small = "https://m.media-amazon.com/images/I/81small._AC_SL500_.jpg";
    const large = "https://m.media-amazon.com/images/I/81large._AC_SL1500_.jpg";
    const networkClient = new FakeNetworkClient(
      `
        <div data-component-type="s-search-result" data-asin="B000TEST02">
          <h2><a href="/dp/B000TEST02"><span>原題</span></a></h2>
        </div>
      `,
      new Map([
        [
          "/dp/B000TEST02",
          `
            <div id="leftCol">
              <div id="imageBlock">
                <img data-a-dynamic-image='{"${small}":[500,500],"${large}":[1500,1500]}' />
              </div>
            </div>
          `,
        ],
      ]),
      new Set([large]),
    );
    const service = new AmazonJpImageService(networkClient as unknown as NetworkClient);

    const result = await service.enhance(baseCrawlerData, Website.JAVDB);

    expect(result.poster_url).toBe(large);
    expect(result.upgraded).toBe(true);
  });
});
