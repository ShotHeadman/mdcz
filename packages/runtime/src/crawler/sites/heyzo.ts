import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { pageIdentityUrl, toAbsoluteUrl } from "./helpers";
import { parseIsoDurationToSeconds, readFirstJsonLdRecord, readJsonLdActors } from "./jsonLd";

export class HeyzoCrawler extends BaseCrawler {
  static readonly numberPattern = /^HEYZO[-_]?\d+$/iu;
  site(): Website {
    return Website.HEYZO;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const id = context.number.match(/^HEYZO[-_]?(\d+)$/iu)?.[1];
    return id ? `https://www.heyzo.com/moviepages/${id}/index.html` : null;
  }

  protected async parseSearchPage(_context: Context, _$: CheerioAPI, searchUrl: string): Promise<SearchPageResolution> {
    return this.reuseSearchDocument(searchUrl);
  }

  protected async parseDetailPage(_context: Context, $: CheerioAPI, detailUrl: string): Promise<CrawlerData | null> {
    const movie = readFirstJsonLdRecord($);
    if (!movie || typeof movie.name !== "string") return null;
    const id = pageIdentityUrl($).match(/\/moviepages\/(\d+)\//u)?.[1];
    return {
      number: id ? `HEYZO-${id}` : "",
      title: movie.name,
      actors: readJsonLdActors(movie.actor),
      genres: [],
      studio: "HEYZO",
      publisher: "HEYZO",
      plot: typeof movie.description === "string" ? movie.description : undefined,
      release_date: parseDate(typeof movie.dateCreated === "string" ? movie.dateCreated : undefined),
      durationSeconds: parseIsoDurationToSeconds(movie.duration),
      thumb_url: toAbsoluteUrl(detailUrl, typeof movie.image === "string" ? movie.image : undefined),
      scene_images: [],
      website: Website.HEYZO,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = { site: Website.HEYZO, crawler: HeyzoCrawler };
