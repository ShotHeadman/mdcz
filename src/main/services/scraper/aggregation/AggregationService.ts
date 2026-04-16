import type { Configuration } from "@main/services/config";
import type { CrawlerProvider } from "@main/services/crawler";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { buildCrawlerOptions } from "../crawlerOptions";
import { FieldAggregator } from "./FieldAggregator";
import type { AggregationResult, AggregationStats, SiteCrawlResult } from "./types";

interface CacheEntry {
  result: AggregationResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
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
  results: SiteCrawlResult[];
  successes: Map<Website, CrawlerData>;
  inFlightSites: Set<Website>;
  state: CrawlerExecutionState;
}

export class AggregationService {
  private readonly logger = loggerService.getLogger("AggregationService");
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly crawlerProvider: CrawlerProvider) {}

  async aggregate(number: string, config: Configuration, signal?: AbortSignal): Promise<AggregationResult | null> {
    const cacheKey = number;
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.info(`Cache hit for ${number}`);
      return cached;
    }

    const enabledSites = this.resolveActiveSites(number, config);
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

    const stats: AggregationStats = {
      totalSites: enabledSites.length,
      successCount,
      failedCount,
      skippedCount,
      siteResults,
      totalElapsedMs,
    };

    if (successes.size === 0) {
      this.logger.warn(`No successful crawls for ${number}`);
      return null;
    }

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

  private resolveActiveSites(number: string, config: Configuration): Website[] {
    const ordered = [...new Set(config.scrape.sites)];
    const isFc2 = FC2_NUMBER_PATTERN.test(number.trim().toUpperCase());
    const candidates = ordered.filter((site) => (isFc2 ? FC2_SITE_WHITELIST.has(site) : !FC2_ONLY_SITES.has(site)));

    if (isFc2) {
      this.logger.info(`FC2 number detected for ${number}; limiting sites to: ${candidates.join(", ") || "(none)"}`);
    }

    return candidates.filter((site) => {
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
      results,
      successes,
      inFlightSites,
      state: {
        nextIndex: 0,
        stopEarly: false,
      },
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
        );
      } catch (error) {
        result = {
          site,
          success: false,
          error: toErrorMessage(error),
          failureReason: "unknown",
          elapsedMs: 0,
        };
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
    const configuredTimeoutMs = options.timeoutMs ?? perCrawlerTimeoutMs;
    options.timeoutMs = Math.max(1, Math.min(configuredTimeoutMs, perCrawlerTimeoutMs));
    const timeoutMessage = `${site} exceeded crawler budget (${perCrawlerTimeoutMs}ms)`;

    try {
      const response = await this.crawlerProvider.crawl({
        number,
        site,
        options,
      });

      const elapsedMs = Date.now() - start;

      if (response.result.success) {
        const data = response.result.data;
        this.logger.info(`${site} succeeded for ${number} in ${elapsedMs}ms`);
        return {
          site,
          success: true,
          data: {
            ...data,
            website: data.website ?? site,
            number: data.number || number,
          },
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
      return {
        site,
        success: false,
        error: message,
        failureReason: timedOut ? "timeout" : "unknown",
        elapsedMs,
      };
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
    if (config.download.downloadSceneImages || config.download.generateNfo) {
      return false;
    }

    if (successes.size === 0) {
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

    this.cache.set(key, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
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
}
