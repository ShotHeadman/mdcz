import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { parseClockDurationToSeconds } from "./helpers";

export class CaribbeancomCrawler extends BaseCrawler {
  static readonly numberPattern = /^CARIB(?:BEANCOM)?[-_]?\d{6}[-_]\d{3}$/iu;
  site(): Website {
    return Website.CARIBBEANCOM;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const id = context.number.match(/(\d{6})[-_](\d{3})$/u);
    return id ? `https://www.caribbeancom.com/moviepages/${id[1]}-${id[2]}/index.html` : null;
  }

  protected override async fetch(url: string, context: Context): Promise<string> {
    return new TextDecoder("euc-jp", { fatal: true }).decode(
      await this.gateway.fetchContent(url, this.createFetchOptions(context)),
    );
  }

  protected async parseSearchPage(_context: Context, _$: CheerioAPI, searchUrl: string): Promise<SearchPageResolution> {
    return this.reuseSearchDocument(searchUrl);
  }

  protected async parseDetailPage(_context: Context, $: CheerioAPI): Promise<CrawlerData | null> {
    const raw = $.html().match(/\bvar Movie\s*=\s*(\{[^\n]+\});/u)?.[1];
    const movie = raw ? (JSON.parse(raw) as { movie_id?: string; sample_flash_url?: string }) : undefined;
    const title = $(".movie-info h1").text().trim();
    if (!title) return null;
    const id = movie?.movie_id;
    return {
      number: id ? `CARIB-${id}` : "",
      title,
      actors: $(".movie-info [itemprop='actor']")
        .toArray()
        .map((element) => $(element).text().trim()),
      genres: $(".movie-info [itemprop='genre']")
        .toArray()
        .map((element) => $(element).text().trim()),
      studio: "カリビアンコム",
      publisher: "カリビアンコム",
      plot: $(".movie-info [itemprop='description']").text().trim() || undefined,
      release_date: parseDate($(".movie-spec:has(.spec-title:contains('配信日')) .spec-content").text()),
      durationSeconds: parseClockDurationToSeconds($(".movie-info [itemprop='duration']").text().trim()),
      series: $(".movie-info a[href^='/series/']").first().text().trim() || undefined,
      thumb_url: id ? `https://www.caribbeancom.com/moviepages/${id}/images/l_l.jpg` : undefined,
      scene_images: [],
      trailer_url: movie?.sample_flash_url,
      website: Website.CARIBBEANCOM,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = { site: Website.CARIBBEANCOM, crawler: CaribbeancomCrawler };
