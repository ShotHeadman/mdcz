import type { SiteRequestConfig } from "@mdcz/runtime/network";
import type { Website } from "@mdcz/shared/enums";
import type { CrawlerConstructor, CrawlerRegistration } from "./registration";
import { crawlerRegistration as avbaseRegistration } from "./sites/avbase";
import { crawlerRegistration as avwikidbRegistration } from "./sites/avwikidb";
import { crawlerRegistration as dahliaRegistration } from "./sites/dahlia";
import { crawlerRegistration as dmmRegistration } from "./sites/dmm";
import { crawlerRegistration as dmmTvRegistration } from "./sites/dmm/dmm_tv";
import { crawlerRegistration as falenoRegistration } from "./sites/faleno";
import { crawlerRegistration as fc2Registration } from "./sites/fc2";
import { crawlerRegistration as fc2hubRegistration } from "./sites/fc2hub";
import { crawlerRegistration as jav321Registration } from "./sites/jav321";
import { crawlerRegistration as javbusRegistration } from "./sites/javbus";
import { crawlerRegistration as javdbRegistration } from "./sites/javdb";
import { crawlerRegistration as kingdomRegistration } from "./sites/kingdom";
import { crawlerRegistration as kmProduceRegistration } from "./sites/kmproduce";
import { crawlerRegistration as mgstageRegistration } from "./sites/mgstage";
import { crawlerRegistration as ppvdatabankRegistration } from "./sites/ppvdatabank";
import { crawlerRegistration as prestigeRegistration } from "./sites/prestige";
import { crawlerRegistration as r18Registration } from "./sites/r18";
import { crawlerRegistration as sokmilRegistration } from "./sites/sokmil";

const crawlerConstructors = new Map<Website, CrawlerConstructor>();

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

const crawlerRegistrations: CrawlerRegistration[] = [
  avbaseRegistration,
  avwikidbRegistration,
  dahliaRegistration,
  dmmRegistration,
  dmmTvRegistration,
  falenoRegistration,
  fc2Registration,
  fc2hubRegistration,
  jav321Registration,
  javbusRegistration,
  javdbRegistration,
  kingdomRegistration,
  kmProduceRegistration,
  mgstageRegistration,
  ppvdatabankRegistration,
  prestigeRegistration,
  r18Registration,
  sokmilRegistration,
];

for (const registration of crawlerRegistrations) {
  registerCrawler(registration.site, registration.crawler);
}
