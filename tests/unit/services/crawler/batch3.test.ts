import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient } from "./fixtures";

describe("Batch3 crawlers", () => {
  it("registers all websites as native crawlers", () => {
    const provider = new CrawlerProvider({
      fetchGateway: new FetchGateway(new FixtureNetworkClient(new Map())),
    });

    const nonNativeSites = provider
      .listSites()
      .filter((siteInfo) => !siteInfo.native)
      .map((siteInfo) => siteInfo.site);

    expect(nonNativeSites).toEqual([]);
  });
});
