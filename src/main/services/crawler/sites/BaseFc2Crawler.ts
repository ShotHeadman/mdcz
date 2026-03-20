import type { CrawlerData } from "@shared/types";

import { BaseCrawler } from "../base/BaseCrawler";
import type { Context, CrawlerInput } from "../base/types";
import { normalizeFc2Number } from "./helpers";

/**
 * Base class for FC2-family crawlers.
 *
 * Shared behavior:
 * - Number normalization via `normalizeFc2Number`
 * - Common CrawlerData fields: `series: "FC2系列"`,
 *   `publisher === studio`, FC2-prefixed number formatting
 *
 * Subclasses must implement:
 * - `site()` — return the Website enum value
 * - `generateSearchUrl()` / `parseSearchPage()` / `parseDetailPage()` — site-specific parsing
 */
export abstract class BaseFc2Crawler extends BaseCrawler {
  protected static readonly FC2_SERIES = "FC2系列";

  protected override newContext(input: CrawlerInput): Context {
    const context = super.newContext(input);
    context.number = normalizeFc2Number(input.number);
    return context;
  }

  /**
   * Format the FC2 number for output CrawlerData.
   * Override if the site uses a different format.
   */
  protected formatFc2Number(digits: string): string {
    return `FC2-${digits}`;
  }

  /**
   * Build common FC2 CrawlerData fields.
   * Subclasses call this and spread the result, overriding only site-specific fields.
   */
  protected buildFc2Data(
    context: Context,
    fields: {
      title: string;
      actors?: string[];
      studio?: string;
      genres?: string[];
      thumbUrl?: string;
      posterUrl?: string;
      plot?: string;
      releaseDate?: string;
      durationSeconds?: number;
      rating?: number;
      sceneImageUrls?: string[];
      trailerUrl?: string;
    },
  ): CrawlerData {
    const studio = fields.studio || undefined;

    return {
      title: fields.title,
      number: this.formatFc2Number(context.number),
      actors: fields.actors ?? [],
      genres: fields.genres ?? [],
      studio,
      director: undefined,
      publisher: studio,
      series: BaseFc2Crawler.FC2_SERIES,
      plot: fields.plot,
      release_date: fields.releaseDate,
      durationSeconds: fields.durationSeconds,
      rating: fields.rating,
      thumb_url: fields.thumbUrl,
      poster_url: fields.posterUrl,
      fanart_url: undefined,
      scene_images: fields.sceneImageUrls ?? [],
      trailer_url: fields.trailerUrl,
      website: this.site(),
    };
  }
}
