import { Website } from "@mdcz/shared/enums";

import type { CrawlerRegistration } from "../registration";
import { BaseH0930FamilyCrawler, type H0930FamilySite } from "./H0930FamilyCrawler";

const H4610_SITE: H0930FamilySite = {
  site: Website.H4610,
  baseUrl: "https://www.h4610.com",
  numberPrefix: "H4610",
  provider: "H4610",
  publicHosts: ["h4610.com", "www.h4610.com", "smovie.h4610.com"],
};

export class H4610Crawler extends BaseH0930FamilyCrawler {
  protected readonly family = H4610_SITE;
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.H4610,
  crawler: H4610Crawler,
};
