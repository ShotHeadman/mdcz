/// <reference types="vite/client" />

import {
  getCrawlerConstructor,
  listRegisteredCrawlerRequestConfigs,
  listRegisteredCrawlerSites,
} from "@mdcz/runtime/crawler";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

type CrawlerModule = {
  crawlerRegistration?: {
    site: Website;
  };
} & Record<string, unknown>;

const crawlerModules = import.meta.glob<CrawlerModule>("../../../../packages/runtime/src/crawler/sites/**/*.ts", {
  eager: true,
});

const collectConcreteCrawlerSites = (): Website[] => {
  return Object.values(crawlerModules).flatMap((module) => {
    const exportsCrawler = Object.entries(module).some(([exportName, value]) => {
      return exportName.endsWith("Crawler") && !exportName.startsWith("Base") && typeof value === "function";
    });

    if (!exportsCrawler) {
      return [];
    }

    expect(module.crawlerRegistration).toBeDefined();
    return module.crawlerRegistration ? [module.crawlerRegistration.site] : [];
  });
};

describe("crawler registry", () => {
  it("auto-discovers crawler registrations from site modules", () => {
    const concreteCrawlerSites = collectConcreteCrawlerSites();

    expect(new Set(listRegisteredCrawlerSites())).toEqual(new Set(concreteCrawlerSites));
    expect(new Set(concreteCrawlerSites)).toEqual(new Set(Object.values(Website)));

    for (const site of concreteCrawlerSites) {
      expect(getCrawlerConstructor(site)).toBeDefined();
    }
  });

  it("collects site request configs from registered crawlers", () => {
    const requestConfigIds = listRegisteredCrawlerRequestConfigs().map((config) => config.id);

    expect(requestConfigIds).toContain("crawler:javbus");
    expect(requestConfigIds).toContain("crawler:javdb");
  });
});
