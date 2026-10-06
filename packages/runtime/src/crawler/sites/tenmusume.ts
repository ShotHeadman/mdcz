import { Website } from "@mdcz/shared/enums";
import type { CrawlerRegistration } from "../registration";
import { BaseD2PassCrawler } from "./BaseD2PassCrawler";

export class TenMusumeCrawler extends BaseD2PassCrawler {
  static readonly numberPattern = /^10MU(?:SUME)?[-_]?\d{6}[-_]\d{2}$/iu;
  protected readonly domain = "www.10musume.com";
  protected readonly prefix = "10MU";
  protected readonly studio = "天然むすめ";
  site(): Website {
    return Website.TENMUSUME;
  }
}

export const crawlerRegistration: CrawlerRegistration = { site: Website.TENMUSUME, crawler: TenMusumeCrawler };
