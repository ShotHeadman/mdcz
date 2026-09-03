import { DmmTvCrawler } from "@mdcz/runtime/crawler/sites/dmm/dmm_tv";
import { NetworkClient } from "@mdcz/runtime/network";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

class BodyAwareDmmTvNetworkClient extends NetworkClient {
  readonly requests: Array<{ url: string; body?: unknown }> = [];

  constructor(private readonly htmlFixtures: Map<string, string>) {
    super({});
  }

  override async getText(url: string): Promise<string> {
    this.requests.push({ url });
    const fixture = this.htmlFixtures.get(url);
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    return fixture;
  }

  override async postJson<TResponse>(url: string, payload: unknown): Promise<TResponse> {
    this.requests.push({ url, body: payload });
    if (url !== "https://api.video.dmm.co.jp/graphql") {
      throw new Error(`Missing fixture for ${url}`);
    }

    const operation = payload as {
      operationName?: string;
      variables?: Record<string, unknown>;
    };
    const operationName = operation.operationName;

    if (operationName === "ContentPageData") {
      return { data: {} } as TResponse;
    }

    if (operationName === "AvSearch") {
      const queryWord = String(operation.variables?.queryWord ?? "");
      if (queryWord === "zzzz-999") {
        return {
          data: {
            legacySearchPPV: {
              result: {
                contents: [{ id: "unrelated001", title: "Completely Different Title" }],
              },
            },
          },
        } as TResponse;
      }

      return {
        data: {
          legacySearchPPV: {
            result: {
              contents: [],
            },
          },
        },
      } as TResponse;
    }

    if (operationName === "AnimeSearch") {
      return {
        data: {
          legacySearchPPV: {
            result: {
              contents: [],
            },
          },
        },
      } as TResponse;
    }

    throw new Error(`Unexpected payload for ${url}`);
  }
}

describe("DmmTvCrawler", () => {
  it("classifies login-wall detail pages", async () => {
    const number = "DLDSS-463";
    const guessedDetailUrl = "https://video.dmm.co.jp/av/content/?id=1dldss00463";
    const detailHtml = `
      <html>
        <head>
          <title>ログイン - DMM</title>
        </head>
        <body>
          <form id="login_form" action="https://accounts.dmm.co.jp/service/login/password">
            <input type="password" name="password" />
          </form>
        </body>
      </html>
    `;

    const networkClient = new FixtureNetworkClient(
      new Map<string, unknown>([
        [guessedDetailUrl, detailHtml],
        ["https://api.video.dmm.co.jp/graphql", { data: {} }],
      ]),
    );
    const crawler = new DmmTvCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number,
      site: Website.DMM_TV,
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("expected failure");
    }

    expect(response.result.error).toBe("DMM_TV: login wall");
  });

  it("does not run GraphQL search fallback for manual detail URLs", async () => {
    const manualDetailUrl = "https://video.dmm.co.jp/av/content/?id=1knbm00007";
    const networkClient = new BodyAwareDmmTvNetworkClient(
      new Map<string, string>([
        [manualDetailUrl, `<html><body><script>self.__next_f.push([1,"shell"])</script></body></html>`],
      ]),
    );
    const crawler = new DmmTvCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "KNBM-007",
      site: Website.DMM_TV,
      options: {
        detailUrl: manualDetailUrl,
      },
    });

    expect(response.result.success).toBe(false);
    const searchPayloads = networkClient.requests
      .filter((request) => request.url === "https://api.video.dmm.co.jp/graphql")
      .map((request) => request.body as { operationName?: string })
      .filter((payload) => payload.operationName === "AvSearch" || payload.operationName === "AnimeSearch");
    expect(searchPayloads).toEqual([]);
  });

  it("does not accept a single GraphQL search result without an id or title match", async () => {
    const guessedDetailUrl = "https://video.dmm.co.jp/av/content/?id=1zzzz00999";
    const networkClient = new BodyAwareDmmTvNetworkClient(
      new Map<string, string>([
        [guessedDetailUrl, `<html><body><script>self.__next_f.push([1,"shell"])</script></body></html>`],
      ]),
    );
    const crawler = new DmmTvCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number: "ZZZZ-999",
      site: Website.DMM_TV,
    });

    expect(response.result.success).toBe(false);
    const requestedContentIds = networkClient.requests
      .filter((request) => request.url === "https://api.video.dmm.co.jp/graphql")
      .map((request) => request.body as { operationName?: string; variables?: Record<string, unknown> })
      .filter((payload) => payload.operationName === "ContentPageData")
      .map((payload) => String(payload.variables?.id ?? ""));
    expect(requestedContentIds).not.toContain("unrelated001");
  });
});
