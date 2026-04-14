import type { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { FailureReason } from "../../crawler/base/types";

/** Maps each CrawlerData field to the Website that provided the winning value. */
export type SourceMap = Partial<Record<keyof CrawlerData, Website>>;

export interface ImageAlternatives {
  thumb_url: string[];
  poster_url: string[];
  scene_images: string[][];
  scene_images_source?: Website;
  scene_image_sources?: Website[];
}

/** Result of aggregating crawler data from multiple sources. */
export interface AggregationResult {
  data: CrawlerData;
  sources: SourceMap;
  imageAlternatives: ImageAlternatives;
  stats: AggregationStats;
}

/** Per-site timing and status information. */
export interface SiteCrawlResult {
  site: Website;
  success: boolean;
  data?: CrawlerData;
  error?: string;
  failureReason?: FailureReason;
  elapsedMs: number;
}

/** Summary statistics for an aggregation run. */
export interface AggregationStats {
  totalSites: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  siteResults: SiteCrawlResult[];
  totalElapsedMs: number;
}

/** Strategy for aggregating a field across sources. */
export type AggregationStrategy = "first_non_null" | "first_non_empty" | "longest" | "union" | "highest_quality";

/** Field-to-strategy mapping for CrawlerData fields. */
export const FIELD_STRATEGIES: Partial<Record<keyof CrawlerData, AggregationStrategy>> = {
  title: "first_non_null",
  title_zh: "first_non_null",
  number: "first_non_null",
  studio: "first_non_null",
  director: "first_non_null",
  publisher: "first_non_null",
  series: "first_non_null",
  release_date: "first_non_null",
  durationSeconds: "first_non_null",
  rating: "first_non_null",
  thumb_url: "highest_quality",
  poster_url: "highest_quality",
  fanart_url: "first_non_null",
  trailer_url: "first_non_null",
  website: "first_non_null",
  content_type: "first_non_null",
  plot: "longest",
  plot_zh: "longest",
  actors: "first_non_empty",
  genres: "first_non_empty",
  scene_images: "first_non_empty",
};
