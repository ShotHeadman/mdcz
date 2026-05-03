import type { Configuration } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import { toErrorMessage } from "@mdcz/shared/error";
import type { CrawlerData } from "@mdcz/shared/types";
import type { RuntimeCrawlerFailureReason, RuntimeCrawlerOptions, RuntimeCrawlerProvider } from "../crawler/types";
import { noopRuntimeLogger, type RuntimeLogger } from "../shared";

export type SourceMap = Partial<Record<keyof CrawlerData, Website>>;

export interface ImageAlternatives {
  thumb_url: string[];
  poster_url: string[];
  scene_images: string[][];
  scene_images_source?: Website;
  scene_image_sources?: Website[];
}

export interface AggregationResult {
  data: CrawlerData;
  sources: SourceMap;
  imageAlternatives: ImageAlternatives;
  stats: AggregationStats;
}

export interface SiteCrawlResult {
  site: Website;
  success: boolean;
  data?: CrawlerData;
  error?: string;
  failureReason?: RuntimeCrawlerFailureReason;
  elapsedMs: number;
}

export interface AggregationStats {
  totalSites: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  siteResults: SiteCrawlResult[];
  totalElapsedMs: number;
}

export type AggregationStrategy = "first_non_null" | "first_non_empty" | "longest" | "union" | "highest_quality";

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

const SCRIPT_PATTERN =
  /(?:<script|<\/script|<style|function\s*\(|=>\s*\{|window\.|document\.\w+\(|var\s+\w+\s*=|const\s+\w+\s*=|let\s+\w+\s*=)/i;

interface AggregationBehavior {
  preferLongerPlot: boolean;
  maxSceneImages: number;
  maxActors: number;
  maxGenres: number;
}

const DEFAULT_BEHAVIOR: AggregationBehavior = {
  preferLongerPlot: true,
  maxSceneImages: 30,
  maxActors: 50,
  maxGenres: 30,
};

type SourceEntry = { site: Website; data: CrawlerData };
type ResolvedField = {
  value: unknown;
  source?: Website;
  alternatives?: string[];
  sceneImageAlternatives?: string[][];
  sceneImageAlternativeSources?: Website[];
};

const EMPTY_IMAGE_ALTERNATIVES: ImageAlternatives = {
  thumb_url: [],
  poster_url: [],
  scene_images: [],
  scene_image_sources: [],
};

type PrimaryImageAlternativeField = "thumb_url" | "poster_url";

const looksLikeCode = (text: string): boolean => SCRIPT_PATTERN.test(text);
const isPrimaryImageField = (field: keyof CrawlerData): field is PrimaryImageAlternativeField =>
  field === "thumb_url" || field === "poster_url";

export class FieldAggregator {
  private readonly behavior: AggregationBehavior;

  constructor(
    private readonly priorities: Partial<Record<string, Website[]>>,
    behavior?: Partial<AggregationBehavior>,
  ) {
    this.behavior = { ...DEFAULT_BEHAVIOR, ...behavior };
  }

  aggregate(results: Map<Website, CrawlerData>): {
    data: CrawlerData;
    sources: SourceMap;
    imageAlternatives: ImageAlternatives;
  } {
    const sources: SourceMap = {};
    const imageAlternatives: ImageAlternatives = { ...EMPTY_IMAGE_ALTERNATIVES };
    const entries: SourceEntry[] = Array.from(results.entries()).map(([site, data]) => ({ site, data }));
    if (entries.length === 0) {
      throw new Error("No results to aggregate");
    }

    const firstEntry = entries[0];
    const resolve = <K extends keyof CrawlerData>(field: K): CrawlerData[K] => {
      const strategy = FIELD_STRATEGIES[field] ?? "first_non_null";
      const priority = (this.priorities[field] ?? []) as Website[];
      const ordered = this.orderByPriority(entries, priority);
      const result = this.applyStrategy(field, strategy, ordered);
      if (isPrimaryImageField(field)) {
        imageAlternatives[field] = result.alternatives ?? [];
      } else if (field === "scene_images") {
        imageAlternatives.scene_images = result.sceneImageAlternatives ?? [];
        imageAlternatives.scene_images_source = result.source;
        imageAlternatives.scene_image_sources = result.sceneImageAlternativeSources ?? [];
      }
      if (result.value !== undefined && result.value !== null) {
        sources[field] = result.source;
      }
      return result.value as CrawlerData[K];
    };

    const data: CrawlerData = {
      title: resolve("title") || firstEntry.data.title,
      title_zh: resolve("title_zh"),
      number: resolve("number") || firstEntry.data.number,
      actors: resolve("actors") ?? [],
      genres: resolve("genres") ?? [],
      content_type: resolve("content_type"),
      studio: resolve("studio"),
      director: resolve("director"),
      publisher: resolve("publisher"),
      series: resolve("series"),
      plot: resolve("plot"),
      plot_zh: resolve("plot_zh"),
      release_date: resolve("release_date"),
      durationSeconds: resolve("durationSeconds"),
      rating: resolve("rating"),
      thumb_url: resolve("thumb_url"),
      poster_url: resolve("poster_url"),
      fanart_url: resolve("fanart_url"),
      scene_images: resolve("scene_images") ?? [],
      trailer_url: resolve("trailer_url"),
      website: resolve("website") ?? firstEntry.data.website,
    };

    return { data, sources, imageAlternatives };
  }

  private orderByPriority(entries: SourceEntry[], priority: Website[]): SourceEntry[] {
    if (priority.length === 0) {
      return entries;
    }

    const ordered: SourceEntry[] = [];
    const remaining = new Set(entries.map((entry) => entry.site));
    for (const site of priority) {
      const entry = entries.find((item) => item.site === site);
      if (entry) {
        ordered.push(entry);
        remaining.delete(site);
      }
    }
    for (const entry of entries) {
      if (remaining.has(entry.site)) {
        ordered.push(entry);
      }
    }
    return ordered;
  }

  private applyStrategy(
    field: keyof CrawlerData,
    strategy: AggregationStrategy,
    entries: SourceEntry[],
  ): ResolvedField {
    switch (strategy) {
      case "first_non_null":
        return this.firstNonNull(field, entries);
      case "first_non_empty":
        return this.firstNonEmpty(field, entries);
      case "longest":
        return this.longest(field, entries);
      case "union":
        return this.union(field, entries);
      case "highest_quality":
        return this.highestQuality(field, entries);
      default:
        return this.firstNonNull(field, entries);
    }
  }

  private firstNonNull(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    for (const entry of entries) {
      const value = entry.data[field];
      if (value !== undefined && value !== null && value !== "") {
        return { value, source: entry.site };
      }
    }
    return { value: undefined };
  }

  private firstNonEmpty(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    if (field === "scene_images") {
      return this.firstNonEmptySceneImages(entries);
    }

    for (const entry of entries) {
      const value = entry.data[field];
      if (Array.isArray(value) && value.length > 0) {
        return { value: field === "actors" ? value.slice(0, this.behavior.maxActors) : value, source: entry.site };
      }
      if (typeof value === "string" && value.length > 0) {
        return { value, source: entry.site };
      }
    }
    return { value: undefined };
  }

  private firstNonEmptySceneImages(entries: SourceEntry[]): ResolvedField {
    const alternatives: string[][] = [];
    const alternativeSources: Website[] = [];
    const seenSets = new Set<string>();
    let winner: string[] | undefined;
    let source: Website | undefined;

    for (const entry of entries) {
      const urls = this.normalizeSceneImageSet(entry.data.scene_images);
      if (urls.length === 0) {
        continue;
      }
      const signature = JSON.stringify(urls);
      if (!winner) {
        winner = urls;
        source = entry.site;
        seenSets.add(signature);
        continue;
      }
      if (seenSets.has(signature)) {
        continue;
      }
      seenSets.add(signature);
      alternatives.push(urls);
      alternativeSources.push(entry.site);
    }

    return {
      value: winner,
      source,
      sceneImageAlternatives: alternatives,
      sceneImageAlternativeSources: alternativeSources,
    };
  }

  private longest(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    let best: { value: string; source: Website } | null = null;
    for (const entry of entries) {
      const value = entry.data[field];
      if (typeof value === "string" && value.length > 0) {
        if (looksLikeCode(value)) continue;
        if (!best || value.length > best.value.length) {
          best = { value, source: entry.site };
        }
      }
    }
    return best ? { value: best.value, source: best.source } : { value: undefined };
  }

  private union(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    if (field === "actors") {
      return this.unionActors(entries);
    }
    if (field === "genres") {
      return this.unionGenres(entries);
    }

    const seen = new Set<string>();
    const merged: unknown[] = [];
    let source: Website | undefined;
    for (const entry of entries) {
      const value = entry.data[field];
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        const key = typeof item === "string" ? item : JSON.stringify(item);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
          source ??= entry.site;
        }
      }
    }
    return { value: merged.length > 0 ? merged : undefined, source };
  }

  private unionActors(entries: SourceEntry[]): { value: string[]; source?: Website } {
    const seen = new Set<string>();
    const merged: string[] = [];
    let source: Website | undefined;
    for (const entry of entries) {
      for (const actor of entry.data.actors) {
        const normalized = actor.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          merged.push(actor);
          source ??= entry.site;
        }
      }
    }
    return { value: merged.slice(0, this.behavior.maxActors), source };
  }

  private unionGenres(entries: SourceEntry[]): { value: string[]; source?: Website } {
    const seen = new Set<string>();
    const merged: string[] = [];
    let source: Website | undefined;
    for (const entry of entries) {
      for (const genre of entry.data.genres) {
        const normalized = genre.normalize("NFKC").toLowerCase().trim();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          merged.push(genre);
          source ??= entry.site;
        }
      }
    }
    return { value: merged.slice(0, this.behavior.maxGenres), source };
  }

  private normalizeSceneImageSet(values: string[]): string[] {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const value of values) {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      urls.push(normalized);
      if (urls.length >= this.behavior.maxSceneImages) {
        break;
      }
    }
    return urls;
  }

  private highestQuality(field: keyof CrawlerData, entries: SourceEntry[]): ResolvedField {
    const candidates = entries.flatMap((entry) => {
      const value = entry.data[field];
      return typeof value === "string" && value.length > 0 ? [{ value, source: entry.site }] : [];
    });
    if (candidates.length === 0) {
      return { value: undefined, alternatives: [] };
    }

    const winner = candidates.find((candidate) => candidate.value.includes("awsimgsrc.dmm.co.jp")) ?? candidates[0];
    const seen = new Set<string>([winner.value]);
    const alternatives: string[] = [];
    for (const candidate of candidates) {
      if (seen.has(candidate.value)) {
        continue;
      }
      seen.add(candidate.value);
      alternatives.push(candidate.value);
    }
    return { value: winner.value, source: winner.source, alternatives };
  }
}

export interface ManualScrapeOptions {
  site: Website;
  detailUrl?: string;
}

interface CacheEntry {
  result: AggregationResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const FC2_SITE_WHITELIST = new Set<Website>([Website.FC2, Website.FC2HUB, Website.PPVDATABANK, Website.JAVDB]);
const FC2_ONLY_SITES = new Set<Website>([Website.FC2, Website.FC2HUB, Website.PPVDATABANK]);
const FC2_NUMBER_PATTERN = /^FC2-?\d+$/iu;
const EARLY_STOP_IMAGE_FIELDS = ["thumb_url", "poster_url"] as const;
const DMM_FAMILY_SITES = new Set<Website>([Website.DMM, Website.DMM_TV]);

interface CrawlerExecutionState {
  nextIndex: number;
  stopEarly: boolean;
}

interface CrawlerExecutionContext {
  sites: Website[];
  number: string;
  config: Configuration;
  perCrawlerTimeoutMs: number;
  signal: AbortSignal;
  abort: () => void;
  fieldAggregator: FieldAggregator;
  manualScrape?: ManualScrapeOptions;
  results: SiteCrawlResult[];
  successes: Map<Website, CrawlerData>;
  inFlightSites: Set<Website>;
  state: CrawlerExecutionState;
}

const buildCrawlerOptions = ({
  site,
  configuration,
  signal,
}: {
  site: Website;
  configuration: Configuration;
  signal?: AbortSignal;
}): RuntimeCrawlerOptions => {
  const options: RuntimeCrawlerOptions = {
    timeoutMs: Math.max(1, Math.trunc(configuration.network.timeout * 1000)),
  };

  const javdbCookie = configuration.network.javdbCookie.trim();
  if (site === Website.JAVDB && javdbCookie) {
    options.cookies = javdbCookie;
  }

  const javbusCookie = configuration.network.javbusCookie.trim();
  if (site === Website.JAVBUS && javbusCookie) {
    options.cookies = javbusCookie;
  }

  if (site === Website.R18_DEV) {
    options.r18MetadataLanguage = configuration.scrape.r18MetadataLanguage;
  }

  if (signal) {
    options.signal = signal;
  }

  return options;
};

export class AggregationService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly logger: RuntimeLogger;

  constructor(
    private readonly crawlerProvider: RuntimeCrawlerProvider,
    options: { logger?: RuntimeLogger } = {},
  ) {
    this.logger = options.logger ?? noopRuntimeLogger;
  }

  async aggregate(
    number: string,
    config: Configuration,
    signal?: AbortSignal,
    manualScrape?: ManualScrapeOptions,
  ): Promise<AggregationResult | null> {
    const cacheKey = this.buildCacheKey(number, manualScrape);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.info(`Cache hit for ${number}`);
      return cached;
    }

    const enabledSites = this.resolveActiveSites(number, config, manualScrape);
    if (enabledSites.length === 0) {
      this.logger.warn(`No active sites for ${number}`);
      return null;
    }

    this.logger.info(`Aggregating ${number} from ${enabledSites.length} sites: ${enabledSites.join(", ")}`);
    const globalStart = Date.now();
    const { maxParallelCrawlers, perCrawlerTimeoutMs, globalTimeoutMs } = config.aggregation;
    const fieldAggregator = this.createFieldAggregator(config);
    const siteResults = await this.executeWithGlobalTimeout(
      enabledSites,
      number,
      config,
      maxParallelCrawlers,
      perCrawlerTimeoutMs,
      globalTimeoutMs,
      fieldAggregator,
      signal,
      manualScrape,
    );

    const successes = this.collectSuccesses(siteResults);
    let successCount = 0;
    let failedCount = 0;
    const skippedCount = Math.max(0, enabledSites.length - siteResults.length);
    for (const result of siteResults) {
      if (result.success && result.data) {
        successCount++;
      } else {
        failedCount++;
      }
    }

    const totalElapsedMs = Date.now() - globalStart;
    this.logger.info(
      `Crawl complete for ${number}: ${successCount} succeeded, ${failedCount} failed, ${skippedCount} skipped in ${totalElapsedMs}ms`,
    );

    if (successes.size === 0) {
      this.logger.warn(`No successful crawls for ${number}`);
      return null;
    }

    const stats: AggregationStats = {
      totalSites: enabledSites.length,
      successCount,
      failedCount,
      skippedCount,
      siteResults,
      totalElapsedMs,
    };
    const {
      data: aggregatedData,
      sources: aggregatedSources,
      imageAlternatives,
    } = fieldAggregator.aggregate(successes);
    const { data, sources } = this.cohereDmmFamilyIdentity(aggregatedData, aggregatedSources, successes, config);
    if (!this.meetsMinimumThreshold(data)) {
      this.logger.warn(
        `Aggregated data for ${number} does not meet minimum threshold (number=${!!data.number}, title=${!!data.title}, thumb=${!!data.thumb_url}, poster=${!!data.poster_url})`,
      );
      return null;
    }

    const result: AggregationResult = { data, sources, imageAlternatives, stats };
    this.putInCache(cacheKey, result);
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private resolveActiveSites(number: string, config: Configuration, manualScrape?: ManualScrapeOptions): Website[] {
    if (manualScrape) {
      return this.filterSitesByCooldown([manualScrape.site]);
    }

    const ordered = [...new Set(config.scrape.sites)];
    const isFc2 = FC2_NUMBER_PATTERN.test(number.trim().toUpperCase());
    const candidates = ordered.filter((site) => (isFc2 ? FC2_SITE_WHITELIST.has(site) : !FC2_ONLY_SITES.has(site)));
    if (isFc2) {
      this.logger.info(`FC2 number detected for ${number}; limiting sites to: ${candidates.join(", ") || "(none)"}`);
    }
    return this.filterSitesByCooldown(candidates);
  }

  private filterSitesByCooldown(sites: Website[]): Website[] {
    return sites.filter((site) => {
      const activeCooldown = this.crawlerProvider.getSiteCooldown(site);
      if (activeCooldown) {
        this.logger.info(
          `Skipping ${site}: site cooldown active (${activeCooldown.remainingMs}ms remaining until ${new Date(
            activeCooldown.cooldownUntil,
          ).toISOString()})`,
        );
        return false;
      }
      return true;
    });
  }

  private collectSuccesses(results: SiteCrawlResult[]): Map<Website, CrawlerData> {
    const successes = new Map<Website, CrawlerData>();
    for (const result of results) {
      if (result.success && result.data) {
        successes.set(result.site, result.data);
      }
    }
    return successes;
  }

  private async executeWithGlobalTimeout(
    sites: Website[],
    number: string,
    config: Configuration,
    maxConcurrent: number,
    perCrawlerTimeoutMs: number,
    globalTimeoutMs: number,
    fieldAggregator: FieldAggregator,
    signal?: AbortSignal,
    manualScrape?: ManualScrapeOptions,
  ): Promise<SiteCrawlResult[]> {
    const abortController = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, abortController.signal]) : abortController.signal;
    const abortAggregation = (): void => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    };
    const globalTimer = setTimeout(() => {
      this.logger.warn(`Global timeout (${globalTimeoutMs}ms) reached for ${number}`);
      abortAggregation();
    }, globalTimeoutMs);

    try {
      return await this.executeCrawlers(
        sites,
        number,
        config,
        maxConcurrent,
        perCrawlerTimeoutMs,
        combinedSignal,
        abortAggregation,
        fieldAggregator,
        manualScrape,
      );
    } finally {
      clearTimeout(globalTimer);
    }
  }

  private async executeCrawlers(
    sites: Website[],
    number: string,
    config: Configuration,
    maxConcurrent: number,
    perCrawlerTimeoutMs: number,
    signal: AbortSignal,
    abortAggregation: () => void,
    fieldAggregator: FieldAggregator,
    manualScrape?: ManualScrapeOptions,
  ): Promise<SiteCrawlResult[]> {
    const results: SiteCrawlResult[] = [];
    const successes = new Map<Website, CrawlerData>();
    const inFlightSites = new Set<Website>();
    if (sites.length === 0) {
      return results;
    }

    const executionContext: CrawlerExecutionContext = {
      sites,
      number,
      config,
      perCrawlerTimeoutMs,
      signal,
      abort: abortAggregation,
      fieldAggregator,
      manualScrape,
      results,
      successes,
      inFlightSites,
      state: { nextIndex: 0, stopEarly: false },
    };
    const workerCount = Math.min(sites.length, Math.max(1, maxConcurrent));
    await Promise.all(Array.from({ length: workerCount }, () => this.runCrawlerWorker(executionContext)));
    return results;
  }

  private async runCrawlerWorker(context: CrawlerExecutionContext): Promise<void> {
    while (!context.state.stopEarly && !context.signal.aborted) {
      const site = context.sites[context.state.nextIndex];
      if (!site) {
        return;
      }
      context.state.nextIndex += 1;
      context.inFlightSites.add(site);

      let result: SiteCrawlResult;
      try {
        result = await this.crawlSite(
          site,
          context.number,
          context.config,
          context.perCrawlerTimeoutMs,
          context.signal,
          context.manualScrape,
        );
      } catch (error) {
        result = { site, success: false, error: toErrorMessage(error), failureReason: "unknown", elapsedMs: 0 };
      } finally {
        context.inFlightSites.delete(site);
      }

      if (context.state.stopEarly) {
        continue;
      }
      context.results.push(result);
      if (!result.success || !result.data || context.signal.aborted) {
        continue;
      }
      context.successes.set(result.site, result.data);

      const pendingSites = [...context.inFlightSites, ...context.sites.slice(context.state.nextIndex)];
      if (this.shouldStopEarly(context.successes, pendingSites, context.fieldAggregator, context.config)) {
        context.state.stopEarly = true;
        this.logger.info(
          `Early stop triggered for ${context.number} after ${context.successes.size} successful site(s)`,
        );
        context.abort();
      }
    }
  }

  private async crawlSite(
    site: Website,
    number: string,
    config: Configuration,
    perCrawlerTimeoutMs: number,
    signal: AbortSignal,
    manualScrape?: ManualScrapeOptions,
  ): Promise<SiteCrawlResult> {
    const start = Date.now();
    const siteTimeoutController = new AbortController();
    const siteSignal = AbortSignal.any([signal, siteTimeoutController.signal]);
    let siteTimedOut = false;
    const siteTimer = setTimeout(() => {
      siteTimedOut = true;
      siteTimeoutController.abort();
    }, perCrawlerTimeoutMs);
    const options = buildCrawlerOptions({ site, configuration: config, signal: siteSignal });
    if (manualScrape?.detailUrl) {
      options.detailUrl = manualScrape.detailUrl;
    }
    const configuredTimeoutMs = options.timeoutMs ?? perCrawlerTimeoutMs;
    options.timeoutMs = Math.max(1, Math.min(configuredTimeoutMs, perCrawlerTimeoutMs));
    const timeoutMessage = `${site} exceeded crawler budget (${perCrawlerTimeoutMs}ms)`;

    try {
      const response = await this.crawlerProvider.crawl({ number, site, options });
      const elapsedMs = Date.now() - start;
      if (response.result.success) {
        const data = response.result.data;
        this.logger.info(`${site} succeeded for ${number} in ${elapsedMs}ms`);
        return {
          site,
          success: true,
          data: { ...data, website: data.website ?? site, number: data.number || number },
          elapsedMs,
        };
      }

      const timedOut = siteTimedOut && !signal.aborted;
      const error = timedOut ? timeoutMessage : response.result.error;
      this.logger.warn(`${site} failed for ${number}: ${error} (${elapsedMs}ms)`);
      return {
        site,
        success: false,
        error,
        failureReason: timedOut ? "timeout" : response.result.failureReason,
        elapsedMs,
      };
    } catch (error) {
      const elapsedMs = Date.now() - start;
      const timedOut = siteTimedOut && !signal.aborted;
      const message = timedOut ? timeoutMessage : toErrorMessage(error);
      this.logger.warn(`${site} threw for ${number}: ${message} (${elapsedMs}ms)`);
      return { site, success: false, error: message, failureReason: timedOut ? "timeout" : "unknown", elapsedMs };
    } finally {
      clearTimeout(siteTimer);
    }
  }

  private shouldStopEarly(
    successes: Map<Website, CrawlerData>,
    pendingSites: Website[],
    fieldAggregator: FieldAggregator,
    config: Configuration,
  ): boolean {
    if (config.download.downloadSceneImages || config.download.generateNfo || successes.size === 0) {
      return false;
    }
    const { data, sources } = fieldAggregator.aggregate(successes);
    if (!this.meetsMinimumThreshold(data)) {
      return false;
    }
    if (!sources.title || !this.isWinningSourceFinal("title", sources.title, pendingSites, config)) {
      return false;
    }
    return EARLY_STOP_IMAGE_FIELDS.some((field) => {
      const winner = sources[field];
      return Boolean(data[field] && winner && this.isWinningSourceFinal(field, winner, pendingSites, config));
    });
  }

  private meetsMinimumThreshold(data: CrawlerData): boolean {
    return Boolean(data.number && data.title && (data.thumb_url || data.poster_url));
  }

  private isWinningSourceFinal(
    field: "title" | "thumb_url" | "poster_url",
    winner: Website,
    pendingSites: Website[],
    config: Configuration,
  ): boolean {
    const fieldPriorities = config.aggregation.fieldPriorities as Partial<Record<string, Website[]>>;
    const priorityOrder = fieldPriorities[field] ?? config.scrape.sites;
    const winnerRank = priorityOrder.indexOf(winner);
    if (winnerRank === -1) {
      return pendingSites.length === 0;
    }
    return pendingSites.every((site) => {
      const siteRank = priorityOrder.indexOf(site);
      return siteRank === -1 || siteRank > winnerRank;
    });
  }

  private createFieldAggregator(config: Configuration): FieldAggregator {
    return new FieldAggregator(config.aggregation.fieldPriorities, config.aggregation.behavior);
  }

  private cohereDmmFamilyIdentity(
    data: CrawlerData,
    sources: Partial<Record<keyof CrawlerData, Website>>,
    successes: Map<Website, CrawlerData>,
    config: Configuration,
  ): { data: CrawlerData; sources: Partial<Record<keyof CrawlerData, Website>> } {
    const titleSource = sources.title;
    if (!titleSource || !DMM_FAMILY_SITES.has(titleSource)) {
      return { data, sources };
    }

    const counterpart = titleSource === Website.DMM ? Website.DMM_TV : Website.DMM;
    if (!successes.has(counterpart)) {
      return { data, sources };
    }

    const preferred = successes.get(titleSource);
    if (!preferred) {
      return { data, sources };
    }

    const nextData: CrawlerData = { ...data };
    const nextSources: Partial<Record<keyof CrawlerData, Website>> = { ...sources };
    const preferredGenres = preferred.genres.slice(0, config.aggregation.behavior.maxGenres);
    if (preferredGenres.length > 0) {
      nextData.genres = preferredGenres;
      nextSources.genres = titleSource;
    }

    for (const field of ["number", "studio", "director", "publisher", "series", "release_date"] as const) {
      const value = preferred[field];
      if (!value) {
        continue;
      }
      Object.assign(nextData, { [field]: value });
      nextSources[field] = titleSource;
    }
    return { data: nextData, sources: nextSources };
  }

  private getFromCache(key: string): AggregationResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  private putInCache(key: string, result: AggregationResult): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    this.pruneCache();
  }

  private pruneCache(): void {
    this.evictExpired();
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.cache.delete(oldestKey);
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  private buildCacheKey(number: string, manualScrape?: ManualScrapeOptions): string {
    return manualScrape ? `${number}::manual::${manualScrape.site}::${manualScrape.detailUrl ?? ""}` : number;
  }
}
