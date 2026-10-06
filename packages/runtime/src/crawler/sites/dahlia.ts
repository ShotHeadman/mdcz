import { Website } from "@mdcz/shared/enums";
import type { CrawlerRegistration } from "../registration";
import { BaseLabelCrawler } from "./BaseLabelCrawler";

export class DahliaCrawler extends BaseLabelCrawler {
  static readonly numberPattern = /^DLDSS[-_]?\d+$/iu;
  protected readonly baseUrl = "https://dahlia-av.jp";
  protected readonly studio = "DAHLIA";
  site(): Website {
    return Website.DAHLIA;
  }
}

export const crawlerRegistration: CrawlerRegistration = { site: Website.DAHLIA, crawler: DahliaCrawler };
