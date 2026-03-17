import type { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../base/BaseCrawler";
import { parseDate } from "../base/parser";
import type { Context } from "../base/types";
import { extractByLabel, toAbsoluteUrl } from "./helpers";

/**
 * Configuration for a label-based crawler (DAHLIA, FALENO, etc.).
 * These sites share the same HTML structure and CSS selectors.
 */
export interface LabelCrawlerConfig {
  /** Base URL for the site */
  baseUrl: string;
  /** Default studio name if not found on page */
  defaultStudio: string;
  /** Website enum value */
  website: Website;
  /** Generate search URL from the context number */
  buildSearchUrl: (baseUrl: string, number: string) => string;
  /** Transform thumb URL to poster URL (site-specific crop rules) */
  thumbToPoster: (thumbUrl: string) => string;
}

/**
 * Base class for label-site crawlers (DAHLIA, FALENO).
 *
 * These sites share identical HTML structure:
 * - h1 title with actor names embedded
 * - `a.pop_sample img` for thumb images
 * - `a.genre` for genre links
 * - extractByLabel for metadata fields
 * - `.box_works01_text p` for plot
 */
export abstract class BaseLabelCrawler extends BaseCrawler {
  protected abstract readonly config: LabelCrawlerConfig;

  site(): Website {
    return this.config.website;
  }

  protected async parseSearchPage(_context: Context, $: CheerioAPI, searchUrl: string): Promise<string | null> {
    if ($("h1").length > 0) {
      return searchUrl;
    }

    const fallback = $(".text_name a").first().attr("href");
    return toAbsoluteUrl(this.config.baseUrl, fallback) ?? null;
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI): Promise<CrawlerData | null> {
    const rawTitle = $("h1").first().text().trim();
    if (!rawTitle) {
      return null;
    }

    const actors =
      extractByLabel($, "出演女優")
        ?.split(/[,、]/u)
        .map((item) => item.trim())
        .filter(Boolean) ?? [];
    let title = rawTitle;
    actors.forEach((actor) => {
      title = title.replace(` ${actor}`, "");
    });

    const thumbUrl = toAbsoluteUrl(
      this.config.baseUrl,
      $("a.pop_sample img").first().attr("src")?.replace("?output-quality=60", ""),
    );
    const posterUrl = thumbUrl ? this.config.thumbToPoster(thumbUrl) : undefined;

    const studio = extractByLabel($, "メーカー") ?? this.config.defaultStudio;

    return {
      title,
      number: context.number,
      actors,
      genres: $("a.genre")
        .toArray()
        .map((element) => $(element).text().trim())
        .filter((value) => value.length > 0),
      studio,
      director: extractByLabel($, "导演") ?? extractByLabel($, "導演") ?? extractByLabel($, "監督"),
      publisher: studio,
      series: extractByLabel($, "系列"),
      plot: $(".box_works01_text p").first().text().trim() || undefined,
      release_date: parseDate(extractByLabel($, "配信開始日")) ?? undefined,
      rating: undefined,
      thumb_url: thumbUrl,
      poster_url: posterUrl,
      fanart_url: undefined,
      sample_images: $("a.pop_img")
        .toArray()
        .map((element) => toAbsoluteUrl(this.config.baseUrl, $(element).attr("href")))
        .filter((value): value is string => Boolean(value)),
      trailer_url: toAbsoluteUrl(this.config.baseUrl, $("a.pop_sample").first().attr("href")),
      website: this.config.website,
    };
  }
}
