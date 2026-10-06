import { Website } from "@mdcz/shared/enums";
import type { CrawlerRegistration } from "../registration";
import { BaseLabelCrawler } from "./BaseLabelCrawler";

export class FalenoCrawler extends BaseLabelCrawler {
  static readonly numberPattern = /^(?:FSDSS|FSDMM|FADSS|FADMM|FLNS|FNS|FLCS|FCDSS|MGOLD|JIMMY)[-_]?\d+(?:SP)?$/iu;
  protected readonly baseUrl = "https://faleno.jp/top";
  protected readonly studio = "FALENO";
  site(): Website {
    return Website.FALENO;
  }
}

export const crawlerRegistration: CrawlerRegistration = { site: Website.FALENO, crawler: FalenoCrawler };
