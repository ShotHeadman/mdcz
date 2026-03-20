import { Website } from "@shared/enums";

import type { SiteAdapterConstructor } from "./base/types";
import { AvbaseCrawler } from "./sites/avbase";
import { DahliaCrawler } from "./sites/dahlia";
import { DmmCrawler } from "./sites/dmm";
import { DmmTvCrawler } from "./sites/dmm/dmm_tv";
import { FalenoCrawler } from "./sites/faleno";
import { Fc2Crawler } from "./sites/fc2";
import { Fc2HubCrawler } from "./sites/fc2hub";
import { Jav321Crawler } from "./sites/jav321";
import { JavbusCrawler } from "./sites/javbus";
import { JavdbCrawler } from "./sites/javdb";
import { KMProduceCrawler } from "./sites/kmproduce";
import { MGStageCrawler } from "./sites/mgstage";
import { PrestigeCrawler } from "./sites/prestige";

export type CrawlerConstructor = SiteAdapterConstructor;

const crawlerConstructors = new Map<Website, CrawlerConstructor>();

export const registerCrawler = (site: Website, crawler: CrawlerConstructor): void => {
  crawlerConstructors.set(site, crawler);
};

export const getCrawlerConstructor = (site: Website): CrawlerConstructor | undefined => {
  return crawlerConstructors.get(site);
};

export const listRegisteredCrawlerSites = (): Website[] => {
  return Array.from(crawlerConstructors.keys());
};

registerCrawler(Website.JAVBUS, JavbusCrawler);
registerCrawler(Website.JAVDB, JavdbCrawler);
registerCrawler(Website.DMM, DmmCrawler);
registerCrawler(Website.DMM_TV, DmmTvCrawler);
registerCrawler(Website.PRESTIGE, PrestigeCrawler);
registerCrawler(Website.FALENO, FalenoCrawler);
registerCrawler(Website.DAHLIA, DahliaCrawler);
registerCrawler(Website.FC2, Fc2Crawler);
registerCrawler(Website.FC2HUB, Fc2HubCrawler);
registerCrawler(Website.MGSTAGE, MGStageCrawler);
registerCrawler(Website.JAV321, Jav321Crawler);
registerCrawler(Website.KM_PRODUCE, KMProduceCrawler);
registerCrawler(Website.AVBASE, AvbaseCrawler);
