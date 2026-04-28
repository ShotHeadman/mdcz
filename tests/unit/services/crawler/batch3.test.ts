import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { Batch3FixtureNetworkClient } from "./fixtures";

const batch3Sites: Website[] = [Website.DMM_TV];

describe("Batch3 crawlers", () => {
  it("registers all websites as native crawlers", () => {
    const provider = new CrawlerProvider({
      fetchGateway: new FetchGateway(new Batch3FixtureNetworkClient()),
    });

    const nonNativeSites = provider
      .listSites()
      .filter((siteInfo) => !siteInfo.native)
      .map((siteInfo) => siteInfo.site);

    expect(nonNativeSites).toEqual([]);
  });

  it.each(batch3Sites)("returns normalized crawler data for site %s", async (site) => {
    const provider = new CrawlerProvider({
      fetchGateway: new FetchGateway(new Batch3FixtureNetworkClient()),
    });

    const response = await provider.crawl({
      number: "ABP-123",
      site,
    });

    expect(
      response.result.success,
      `${site} failed: ${response.result.success ? "" : (response.result.error ?? "unknown")}`,
    ).toBe(true);
    if (!response.result.success) {
      throw new Error(`${site} failed: ${response.result.error}`);
    }

    expect(response.result.data.website).toBe(site);
    expect(response.result.data.title.length).toBeGreaterThan(0);
    expect(response.result.data.number.length).toBeGreaterThan(0);
    expect(Array.isArray(response.result.data.actors)).toBe(true);
    expect(Array.isArray(response.result.data.genres)).toBe(true);
    expect(Array.isArray(response.result.data.scene_images)).toBe(true);
  });
});
