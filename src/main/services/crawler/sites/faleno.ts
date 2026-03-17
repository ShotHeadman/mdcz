import { Website } from "@shared/enums";
import type { CheerioAPI } from "cheerio";

import type { Context } from "../base/types";
import { BaseLabelCrawler, type LabelCrawlerConfig } from "./BaseLabelCrawler";
import { toAbsoluteUrl } from "./helpers";

export class FalenoCrawler extends BaseLabelCrawler {
  protected readonly config: LabelCrawlerConfig = {
    baseUrl: "https://faleno.jp",
    defaultStudio: "FALENO",
    website: Website.FALENO,
    buildSearchUrl: (baseUrl, number) => {
      const keyword = number.toLowerCase().replace("-", " ");
      return `${baseUrl}/top/?s=${encodeURIComponent(keyword)}`;
    },
    thumbToPoster: (thumbUrl) =>
      thumbUrl
        .replace("_1200.jpg", "_2125.jpg")
        .replace("_tsp.jpg", "_actor.jpg")
        .replace("1200_re", "2125")
        .replace("_1200-1", "_2125-1"),
  };

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    return this.config.buildSearchUrl(this.config.baseUrl, context.number);
  }

  protected override async parseSearchPage(_context: Context, $: CheerioAPI): Promise<string | null> {
    const href = $(".text_name a").first().attr("href");
    return toAbsoluteUrl(this.config.baseUrl, href) ?? null;
  }
}
