import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../base/BaseCrawler";
import { extractAttr, extractText, parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { toAbsoluteUrl, uniqueStrings } from "./helpers";

const KM_PRODUCE_BASE_URL = "https://www.km-produce.com";

type CheerioInput = Parameters<CheerioAPI>[0];

export class KMProduceCrawler extends BaseCrawler {
  site(): Website {
    return Website.KM_PRODUCE;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = context.number.trim();
    if (!number) {
      return null;
    }

    const baseUrl = this.resolveBaseUrl(context, KM_PRODUCE_BASE_URL);
    return `${baseUrl}/works/${number.toLowerCase()}`;
  }

  protected async parseSearchPage(
    _context: Context,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    return $("h1").length > 0 ? this.reuseSearchDocument(searchUrl) : null;
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI): Promise<CrawlerData | null> {
    const baseUrl = this.resolveBaseUrl(context, KM_PRODUCE_BASE_URL);
    const title = extractText($, "h1");
    if (!title) {
      return null;
    }

    const thumbUrl = toAbsoluteUrl(baseUrl, extractAttr($, "img[src*='/img/title']", "src"));

    const actors = uniqueStrings(
      $("a[href*='/works/category/']")
        .toArray()
        .map((element: CheerioInput) => $(element).text().trim()),
    );

    const genres = uniqueStrings(
      $("a[href*='/works/tag/']")
        .toArray()
        .map((element: CheerioInput) => $(element).text().trim()),
    );

    const studio = uniqueStrings(
      $(".label a")
        .toArray()
        .map((element: CheerioInput) => $(element).text().trim()),
    )[0];

    const pageText = $("body").text().replace(/\s+/gu, " ").trim();
    const releaseDate = parseDate(pageText.match(/\d{4}\/\d{1,2}\/\d{1,2}/u)?.[0]) ?? undefined;
    const durationMinutes = Number.parseInt(pageText.match(/(\d+)分/u)?.[1] ?? "", 10);
    const durationSeconds = Number.isFinite(durationMinutes) ? durationMinutes * 60 : undefined;

    return {
      title,
      number: context.number,
      actors,
      genres,
      content_type: undefined,
      studio,
      director: undefined,
      publisher: undefined,
      series: undefined,
      plot: undefined,
      plot_zh: undefined,
      release_date: releaseDate,
      durationSeconds,
      rating: undefined,
      thumb_url: thumbUrl,
      poster_url: undefined,
      fanart_url: undefined,
      scene_images: [],
      trailer_url: undefined,
      website: Website.KM_PRODUCE,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.KM_PRODUCE,
  crawler: KMProduceCrawler,
};
