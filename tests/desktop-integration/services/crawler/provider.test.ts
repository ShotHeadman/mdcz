import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import type { CrawlerInput, CrawlerResponse, SiteAdapter } from "@mdcz/runtime/crawler/base/types";
import { NetworkClient } from "@mdcz/runtime/network";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

class StubCrawlerProvider extends CrawlerProvider {
  private readonly adapter: SiteAdapter;

  constructor(
    private readonly results: CrawlerResponse["result"][],
    getSiteNetworkKey?: (site: Website) => string,
  ) {
    super({ fetchGateway: new FetchGateway(new NetworkClient()), getSiteNetworkKey });

    this.adapter = {
      site: () => Website.DMM,
      crawl: async (input: CrawlerInput): Promise<CrawlerResponse> => ({
        input,
        elapsedMs: 1,
        result: this.results.shift() ?? {
          success: true,
          data: { title: "Title", number: input.number, actors: [], genres: [], scene_images: [], website: input.site },
        },
      }),
    };
  }

  override getCrawler(_site: Website): SiteAdapter | null {
    return this.adapter;
  }
}

const crawl = async (provider: CrawlerProvider) => await provider.crawl({ number: "ABF-075", site: Website.DMM });

describe("CrawlerProvider site pauses", () => {
  it("keeps a blocked site unavailable until its network changes, a check passes, or it answers again", async () => {
    let networkKey = "direct";
    const regionBlocked = { success: false as const, error: "region page", reason: "region_blocked" as const };
    const provider = new StubCrawlerProvider([regionBlocked, regionBlocked, regionBlocked], () => networkKey);

    await crawl(provider);
    expect(provider.getSiteHealth(Website.DMM)).toEqual({ reason: "region_blocked", until: undefined });

    networkKey = "proxy";
    expect(provider.getSiteHealth(Website.DMM)).toBeUndefined();

    await crawl(provider);
    provider.resetSite(Website.DMM);
    expect(provider.getSiteHealth(Website.DMM)).toBeUndefined();

    await crawl(provider);
    await crawl(provider);
    expect(provider.getSiteHealth(Website.DMM)).toBeUndefined();

    // A login wall can cover only some titles, so answers for other titles leave it in place.
    const walled = new StubCrawlerProvider([
      { success: false, error: "sign-in page", reason: "login_wall" },
      { success: false, error: "not found", reason: "not_found" },
    ]);
    await crawl(walled);
    await crawl(walled);
    await crawl(walled);
    expect(walled.getSiteHealth(Website.DMM)).toEqual({ reason: "login_wall", until: undefined });
  });

  it("pauses only after consecutive transient failures and honors Retry-After", async () => {
    const timeout = { success: false as const, error: "Request timeout", reason: "timeout" as const };
    const provider = new StubCrawlerProvider([
      timeout,
      timeout,
      timeout,
      { success: false, error: "HTTP 429", reason: "rate_limited", retryAfterMs: 5_000 },
    ]);

    await crawl(provider);
    await crawl(provider);
    expect(provider.getSiteHealth(Website.DMM)).toBeUndefined();

    const before = Date.now();
    await crawl(provider);
    const transient = provider.getSiteHealth(Website.DMM);
    expect(transient?.reason).toBe("timeout");
    expect(transient?.until).toBeGreaterThanOrEqual(before + 60_000);

    await crawl(provider);
    const rateLimited = provider.getSiteHealth(Website.DMM);
    expect(rateLimited?.reason).toBe("rate_limited");
    expect(rateLimited?.until).toBeLessThanOrEqual(Date.now() + 5_000);
  });
});
