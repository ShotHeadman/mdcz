import { Website } from "@mdcz/shared/enums";
import type { CrawlerRegistration } from "../registration";
import { BaseD2PassCrawler } from "./BaseD2PassCrawler";

export class OnePondoCrawler extends BaseD2PassCrawler {
  static readonly numberPattern = /^1PON(?:DO)?[-_]?\d{6}[-_]\d{3}$/iu;
  protected readonly domain = "www.1pondo.tv";
  protected readonly prefix = "1PON";
  protected readonly studio = "一本道";
  site(): Website {
    return Website.ONEPONDO;
  }
}

export const crawlerRegistration: CrawlerRegistration = { site: Website.ONEPONDO, crawler: OnePondoCrawler };
