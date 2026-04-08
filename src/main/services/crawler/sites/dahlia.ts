import { Website } from "@shared/enums";

import type { Context } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { BaseLabelCrawler, type LabelCrawlerConfig } from "./BaseLabelCrawler";

export class DahliaCrawler extends BaseLabelCrawler {
  protected readonly config: LabelCrawlerConfig = {
    baseUrl: "https://dahlia-av.jp",
    defaultStudio: "DAHLIA",
    website: Website.DAHLIA,
    buildSearchUrl: (baseUrl, number) => {
      const slug = number.toLowerCase().replaceAll("-", "");
      return `${baseUrl}/works/${slug}/`;
    },
    thumbToPoster: (thumbUrl) =>
      thumbUrl.replace("_web_h4", "_h1").replace("_1200.jpg", "_2125.jpg").replace("_tsp.jpg", "_actor.jpg"),
  };

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    return this.config.buildSearchUrl(this.config.baseUrl, context.number);
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.DAHLIA,
  crawler: DahliaCrawler,
};
