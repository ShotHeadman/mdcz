import { Website } from "@mdcz/shared/enums";

import type { CrawlerRegistration } from "../registration";
import { BaseH0930FamilyCrawler, type H0930FamilySite } from "./H0930FamilyCrawler";

const H0930_SITE: H0930FamilySite = {
  site: Website.H0930,
  baseUrl: "https://www.h0930.com",
  numberPrefix: "H0930",
  provider: "H0930",
  publicHosts: ["h0930.com", "www.h0930.com", "smovie.h0930.com"],
};

export class H0930Crawler extends BaseH0930FamilyCrawler {
  protected readonly family = H0930_SITE;
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.H0930,
  crawler: H0930Crawler,
};
