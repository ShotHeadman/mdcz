/// <reference types="vite/client" />

import type { SiteRequestConfig } from "@main/services/network";
import type { Website } from "@shared/enums";

import type { CrawlerConstructor, CrawlerRegistration } from "./registration";

const crawlerConstructors = new Map<Website, CrawlerConstructor>();

type CrawlerRegistrationModule = {
  crawlerRegistration?: CrawlerRegistration;
};

const registerCrawler = (site: Website, crawler: CrawlerConstructor): void => {
  if (crawlerConstructors.has(site)) {
    throw new Error(`Crawler for site '${site}' is already registered`);
  }

  crawlerConstructors.set(site, crawler);
};

export const getCrawlerConstructor = (site: Website): CrawlerConstructor | undefined => {
  return crawlerConstructors.get(site);
};

export const listRegisteredCrawlerSites = (): Website[] => {
  return Array.from(crawlerConstructors.keys());
};

export const listRegisteredCrawlerRequestConfigs = (): SiteRequestConfig[] => {
  return Array.from(crawlerConstructors.values()).flatMap((crawler) => [...(crawler.siteRequestConfigs ?? [])]);
};

const crawlerRegistrationModules = import.meta.glob<CrawlerRegistrationModule>("./sites/**/*.ts", {
  eager: true,
});

for (const [, module] of Object.entries(crawlerRegistrationModules).sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  if (!module.crawlerRegistration) {
    continue;
  }

  registerCrawler(module.crawlerRegistration.site, module.crawlerRegistration.crawler);
}
