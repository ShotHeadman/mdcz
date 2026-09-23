import type { Configuration } from "@mdcz/shared/config";
import type { Website } from "@mdcz/shared/enums";
import { toErrorMessage } from "@mdcz/shared/error";
import type { CrawlerData } from "@mdcz/shared/types";
import type { RuntimeCrawlerFailureReason, RuntimeCrawlerProvider } from "../crawler/types";
import { runWithCrawlerSource } from "../network/networkExecution";
import { noopRuntimeLogger, type RuntimeLogger } from "../shared";
import { buildCrawlerOptions } from "./crawlerOptions";
import { FieldAggregator, summarizeFailedSiteResults } from "./fieldAggregation";
import { type AdmissionReject, resolveSiteAdmission } from "./siteAdmission";
import { applyTitleRepair } from "./titleRepair";
import { createAbortError, throwIfAborted } from "./utils/abort";

export type { AggregationStrategy } from "./fieldAggregation";
export { FIELD_STRATEGIES, FieldAggregator } from "./fieldAggregation";

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
  rejectedSites: AdmissionReject[];
  totalElapsedMs: number;
}

export interface ManualScrapeOptions {
  site: Website;
  detailUrl?: string;
}

const EARLY_STOP_IMAGE_FIELDS = ["thumb_url", "poster_url"] as const;

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

export class AggregationService {
  private static readonly CACHE_LIMIT = 200;
  private readonly cache = new Map<string, AggregationResult>();
  private readonly inFlight = new Map<string, Promise<AggregationResult>>();
  private readonly logger: RuntimeLogger;
  private readonly config: Configuration;
  private readonly signal?: AbortSignal;

  constructor(
    private readonly crawlerProvider: RuntimeCrawlerProvider,
    options: { config: Configuration; logger?: RuntimeLogger; signal?: AbortSignal },
  ) {
    this.config = structuredClone(options.config);
    this.logger = options.logger ?? noopRuntimeLogger;
    this.signal = options.signal;
  }

  async aggregate(
    number: string,
    options?: { manualScrape?: ManualScrapeOptions; signal?: AbortSignal },
  ): Promise<AggregationResult> {
    throwIfAborted(this.signal);
    throwIfAborted(options?.signal);
    const key = this.buildKey(number, options?.manualScrape);
    const cached = this.cache.get(key);
    if (cached) {
      this.logger.info(`Cache hit for ${number}`);
      return structuredClone(cached);
    }

    let pending = this.inFlight.get(key);
    if (!pending) {
      const execution = this.executeAggregation(number, options?.manualScrape)
        .then((result) => {
          const stored = structuredClone(result);
          this.cache.set(key, stored);
          while (this.cache.size > AggregationService.CACHE_LIMIT) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined || oldest === key) break;
            this.cache.delete(oldest);
          }
          return stored;
        })
        .finally(() => {
          if (this.inFlight.get(key) === execution) this.inFlight.delete(key);
        });
      pending = execution;
      this.inFlight.set(key, execution);
    }

    return structuredClone(await this.awaitShared(pending, options?.signal));
  }

  private async awaitShared<T>(shared: Promise<T>, waiter?: AbortSignal): Promise<T> {
    if (!waiter) return await shared;
    throwIfAborted(waiter);
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(createAbortError());
      waiter.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([shared, aborted]);
    } finally {
      if (onAbort) waiter.removeEventListener("abort", onAbort);
    }
  }

  private async executeAggregation(number: string, manualScrape?: ManualScrapeOptions): Promise<AggregationResult> {
    const { admitted: enabledSites, rejected: rejectedSites } = this.resolveActiveSites(number, manualScrape);
    if (rejectedSites.length > 0) {
      this.logger.info(
        `${number} admitted ${enabledSites.length} sites; skipped: ${rejectedSites
          .map(({ site, reason, detail }) => `${site}(${reason}${detail ? ` ${detail}` : ""})`)
          .join(", ")}`,
      );
    }
    if (enabledSites.length === 0) {
      const message = `No active sites for ${number}`;
      this.logger.warn(message);
      throw new Error(message);
    }

    this.logger.info(`Aggregating ${number} from ${enabledSites.length} sites: ${enabledSites.join(", ")}`);
    const globalStart = Date.now();
    const { maxParallelCrawlers, perCrawlerTimeoutMs, globalTimeoutMs } = this.config.aggregation;
    const fieldAggregator = this.createFieldAggregator(this.config);
    const siteResults = await this.executeWithGlobalTimeout(
      enabledSites,
      number,
      maxParallelCrawlers,
      perCrawlerTimeoutMs,
      globalTimeoutMs,
      fieldAggregator,
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
      const message = summarizeFailedSiteResults(number, siteResults);
      this.logger.warn(message);
      throw new Error(message);
    }

    const stats: AggregationStats = {
      totalSites: enabledSites.length,
      successCount,
      failedCount,
      skippedCount,
      siteResults,
      rejectedSites,
      totalElapsedMs,
    };
    const {
      data: aggregatedData,
      sources: aggregatedSources,
      imageAlternatives,
    } = fieldAggregator.aggregate(successes);
    const data = applyTitleRepair(aggregatedData, this.config.titleRepair);
    const sources = aggregatedSources;
    if (!this.meetsMinimumThreshold(data)) {
      this.logger.warn(
        `Aggregated data for ${number} does not meet minimum threshold (number=${!!data.number}, title=${!!data.title}, thumb=${!!data.thumb_url}, poster=${!!data.poster_url})`,
      );
      throw new Error(`Aggregated data for ${number} does not meet minimum threshold`);
    }

    return { data, sources, imageAlternatives, stats };
  }

  private resolveActiveSites(
    number: string,
    manualScrape?: ManualScrapeOptions,
  ): ReturnType<typeof resolveSiteAdmission> {
    const configuredSites = manualScrape ? [manualScrape.site] : [...new Set(this.config.scrape.sites)];
    const cooldowns = new Map<Website, { remainingMs: number; cooldownUntil: number }>();
    for (const site of configuredSites) {
      const cooldown = this.crawlerProvider.getSiteCooldown(site);
      if (cooldown) {
        cooldowns.set(site, cooldown);
      }
    }

    return resolveSiteAdmission({
      number,
      configuredSites,
      credentials: { fantiaCookie: this.config.network.fantiaCookie },
      cooldowns,
      manualScrape,
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
    maxConcurrent: number,
    perCrawlerTimeoutMs: number,
    globalTimeoutMs: number,
    fieldAggregator: FieldAggregator,
    manualScrape?: ManualScrapeOptions,
  ): Promise<SiteCrawlResult[]> {
    const abortController = new AbortController();
    const combinedSignal = this.signal
      ? AbortSignal.any([this.signal, abortController.signal])
      : abortController.signal;
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
      config: this.config,
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
      const response = await runWithCrawlerSource(
        site,
        async () => await this.crawlerProvider.crawl({ number, site, options }),
      );
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

  private buildKey(number: string, manualScrape?: ManualScrapeOptions): string {
    const mode = manualScrape ? "manual" : "auto";
    const site = manualScrape?.site ?? "";
    const detailUrl = manualScrape?.detailUrl ?? "";
    return `${number.trim().toUpperCase()}::${mode}::${site}::${detailUrl}`;
  }
}
