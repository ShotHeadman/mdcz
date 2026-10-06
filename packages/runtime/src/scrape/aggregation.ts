import type { Configuration } from "@mdcz/shared/config";
import type { Website } from "@mdcz/shared/enums";
import type { SiteResult, SkipReason } from "@mdcz/shared/siteResults";
import type { CrawlerData } from "@mdcz/shared/types";
import { toCrawlerErrorResult } from "../crawler/base/BaseCrawler";
import type { CrawlerProvider } from "../crawler/CrawlerProvider";
import { type CrawlerBudget, reportSiteResult, runWithCrawlerSource, SiteError } from "../network";
import { noopRuntimeLogger, type RuntimeLogger } from "../shared";
import { buildCrawlerOptions } from "./crawlerOptions";
import { FieldAggregator, summarizeFailedSiteResults } from "./fieldAggregation";
import { resolveSiteAdmission } from "./siteAdmission";
import { applyTextRepair } from "./textRepair";
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

export interface SiteCrawlResult extends SiteResult {
  data?: CrawlerData;
}

export interface AggregationStats {
  totalSites: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  siteResults: SiteCrawlResult[];
  totalElapsedMs: number;
}

export interface ManualScrapeOptions {
  site: Website;
  detailUrl?: string;
}

export type CrawlerPort = Pick<CrawlerProvider, "crawl" | "getSiteHealth">;

export type SiteResultSink = (number: string, results: readonly SiteCrawlResult[]) => Promise<void> | void;

const EARLY_STOP_IMAGE_FIELDS = ["thumb_url", "poster_url"] as const;

interface CrawlerExecutionContext {
  sites: Website[];
  number: string;
  perCrawlerTimeoutMs: number;
  signal: AbortSignal;
  stop: (reason: Extract<SkipReason, "early_stop" | "global_timeout">) => void;
  stopReason?: Extract<SkipReason, "early_stop" | "global_timeout">;
  fieldAggregator: FieldAggregator;
  manualScrape?: ManualScrapeOptions;
  results: SiteCrawlResult[];
  successes: Map<Website, CrawlerData>;
  inFlightSites: Set<Website>;
  nextIndex: number;
}

class PausableBudget implements CrawlerBudget {
  private remainingMs: number;
  private startedAt = 0;
  private waiting = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    budgetMs: number,
    private readonly onExpire: () => void,
  ) {
    this.remainingMs = budgetMs;
    this.start();
  }

  pause(): void {
    this.waiting += 1;
    if (this.waiting === 1) this.stop();
  }

  resume(): void {
    this.waiting -= 1;
    if (this.waiting === 0) this.start();
  }

  dispose(): void {
    this.stop();
  }

  private start(): void {
    this.startedAt = Date.now();
    this.timer = setTimeout(this.onExpire, Math.max(0, this.remainingMs));
  }

  private stop(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.remainingMs -= Date.now() - this.startedAt;
  }
}

export class AggregationService {
  private static readonly CACHE_LIMIT = 200;
  private readonly cache = new Map<string, AggregationResult>();
  private readonly inFlight = new Map<string, Promise<AggregationResult>>();
  private readonly logger: RuntimeLogger;
  private readonly config: Configuration;
  private readonly signal?: AbortSignal;
  private readonly recordSiteResults?: SiteResultSink;

  constructor(
    private readonly crawlerProvider: CrawlerPort,
    options: {
      config: Configuration;
      logger?: RuntimeLogger;
      signal?: AbortSignal;
      recordSiteResults?: SiteResultSink;
    },
  ) {
    this.config = structuredClone(options.config);
    this.logger = options.logger ?? noopRuntimeLogger;
    this.signal = options.signal;
    this.recordSiteResults = options.recordSiteResults;
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
    const configuredSites = manualScrape ? [manualScrape.site] : [...new Set(this.config.scrape.sites)];
    const { admitted, rejected } = resolveSiteAdmission({
      number,
      configuredSites,
      credentials: { fantiaCookie: this.config.network.fantiaCookie, javdbCookie: this.config.network.javdbCookie },
      health: new Map(
        configuredSites.flatMap((site) => {
          const health = this.crawlerProvider.getSiteHealth(site);
          return health ? [[site, health] as const] : [];
        }),
      ),
      manualScrape,
    });
    for (const result of rejected) reportSiteResult(result);
    if (rejected.length > 0) {
      this.logger.info(
        `${number} admitted ${admitted.length} sites; skipped: ${rejected
          .map(
            ({ site, skipReason, reason, detail }) =>
              `${site}(${[skipReason, reason, detail].filter(Boolean).join(" ")})`,
          )
          .join(", ")}`,
      );
    }
    if (admitted.length === 0) {
      await this.recordSiteResults?.(number, rejected);
      const message = summarizeFailedSiteResults(number, rejected);
      this.logger.warn(message);
      throw new Error(message);
    }

    this.logger.info(`Aggregating ${number} from ${admitted.length} sites: ${admitted.join(", ")}`);
    const globalStart = Date.now();
    const fieldAggregator = new FieldAggregator(
      this.config.aggregation.fieldPriorities,
      this.config.aggregation.behavior,
    );
    const crawled = await this.executeCrawlers(admitted, number, fieldAggregator, manualScrape);
    throwIfAborted(this.signal);
    const siteResults = [...crawled, ...rejected];
    await this.recordSiteResults?.(number, siteResults);

    const successes = new Map(
      crawled.flatMap((result) =>
        result.status === "success" && result.data ? [[result.site, result.data] as const] : [],
      ),
    );
    const failedCount = siteResults.filter((result) => result.status === "failed").length;
    const skippedCount = siteResults.filter((result) => result.status === "skipped").length;
    const totalElapsedMs = Date.now() - globalStart;
    this.logger.info(
      `Crawl complete for ${number}: ${successes.size} succeeded, ${failedCount} failed, ${skippedCount} skipped in ${totalElapsedMs}ms`,
    );

    if (successes.size === 0) {
      const message = summarizeFailedSiteResults(number, siteResults);
      this.logger.warn(message);
      throw new Error(message);
    }

    const stats: AggregationStats = {
      totalSites: siteResults.length,
      successCount: successes.size,
      failedCount,
      skippedCount,
      siteResults,
      totalElapsedMs,
    };
    const { data: aggregatedData, sources, imageAlternatives } = fieldAggregator.aggregate(successes);
    const data = applyTextRepair(aggregatedData, this.config.titleRepair);
    if (!this.meetsMinimumThreshold(data)) {
      this.logger.warn(
        `Aggregated data for ${number} does not meet minimum threshold (number=${!!data.number}, title=${!!data.title}, thumb=${!!data.thumb_url}, poster=${!!data.poster_url})`,
      );
      throw new Error(`Aggregated data for ${number} does not meet minimum threshold`);
    }

    return { data, sources, imageAlternatives, stats };
  }

  private async executeCrawlers(
    sites: Website[],
    number: string,
    fieldAggregator: FieldAggregator,
    manualScrape?: ManualScrapeOptions,
  ): Promise<SiteCrawlResult[]> {
    const { maxParallelCrawlers, perCrawlerTimeoutMs, globalTimeoutMs } = this.config.aggregation;
    const abortController = new AbortController();
    const context: CrawlerExecutionContext = {
      sites,
      number,
      perCrawlerTimeoutMs,
      signal: this.signal ? AbortSignal.any([this.signal, abortController.signal]) : abortController.signal,
      stop: (reason) => {
        if (abortController.signal.aborted) return;
        context.stopReason = reason;
        abortController.abort();
      },
      fieldAggregator,
      manualScrape,
      results: [],
      successes: new Map(),
      inFlightSites: new Set(),
      nextIndex: 0,
    };
    const globalTimer = setTimeout(() => {
      this.logger.warn(`Global timeout (${globalTimeoutMs}ms) reached for ${number}`);
      context.stop("global_timeout");
    }, globalTimeoutMs);

    try {
      const workerCount = Math.min(sites.length, Math.max(1, maxParallelCrawlers));
      await Promise.all(Array.from({ length: workerCount }, () => this.runCrawlerWorker(context)));
    } finally {
      clearTimeout(globalTimer);
    }

    for (const site of sites.slice(context.nextIndex)) {
      const skipped: SiteCrawlResult = { site, status: "skipped", skipReason: context.stopReason, elapsedMs: 0 };
      reportSiteResult(skipped);
      context.results.push(skipped);
    }
    return context.results;
  }

  private async runCrawlerWorker(context: CrawlerExecutionContext): Promise<void> {
    while (!context.signal.aborted) {
      const site = context.sites[context.nextIndex];
      if (!site) {
        return;
      }
      context.nextIndex += 1;
      context.inFlightSites.add(site);
      let result: SiteCrawlResult;
      try {
        result = await this.crawlSite(site, context);
      } finally {
        context.inFlightSites.delete(site);
      }
      const { data: _data, ...reported } = result;
      reportSiteResult(reported);
      context.results.push(result);
      if (result.status !== "success" || !result.data || context.signal.aborted) {
        continue;
      }
      context.successes.set(result.site, result.data);

      const pendingSites = [...context.inFlightSites, ...context.sites.slice(context.nextIndex)];
      if (this.shouldStopEarly(context.successes, pendingSites, context.fieldAggregator)) {
        this.logger.info(
          `Early stop triggered for ${context.number} after ${context.successes.size} successful site(s)`,
        );
        context.stop("early_stop");
      }
    }
  }

  private async crawlSite(site: Website, context: CrawlerExecutionContext): Promise<SiteCrawlResult> {
    const { number, perCrawlerTimeoutMs } = context;
    const start = Date.now();
    const siteTimeoutController = new AbortController();
    const budget = new PausableBudget(perCrawlerTimeoutMs, () =>
      siteTimeoutController.abort(
        new SiteError("timeout", `${site} exceeded crawler budget (${perCrawlerTimeoutMs}ms)`),
      ),
    );
    const options = buildCrawlerOptions({
      site,
      configuration: this.config,
      signal: AbortSignal.any([context.signal, siteTimeoutController.signal]),
    });
    if (context.manualScrape?.detailUrl) {
      options.detailUrl = context.manualScrape.detailUrl;
    }
    options.timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? perCrawlerTimeoutMs, perCrawlerTimeoutMs));

    try {
      const result = await runWithCrawlerSource(
        site,
        async () => await this.crawlerProvider.crawl({ number, site, options }),
        budget,
      )
        .then((response) => response.result)
        .catch(toCrawlerErrorResult);
      const elapsedMs = Date.now() - start;
      if (result.success) {
        this.logger.info(`${site} succeeded for ${number} in ${elapsedMs}ms`);
        return {
          site,
          status: "success",
          data: { ...result.data, website: result.data.website ?? site },
          elapsedMs,
        };
      }
      if (context.signal.aborted && !siteTimeoutController.signal.aborted) {
        return { site, status: "skipped", skipReason: context.stopReason, elapsedMs };
      }
      const budgetExceeded = siteTimeoutController.signal.reason instanceof SiteError;
      const reason = budgetExceeded ? "timeout" : result.reason;
      const detail = budgetExceeded ? siteTimeoutController.signal.reason.message : result.error;
      this.logger.warn(`${site} failed for ${number}: ${reason}: ${detail} (${elapsedMs}ms)`);
      return { site, status: "failed", reason, detail, httpStatus: result.httpStatus, elapsedMs };
    } finally {
      budget.dispose();
    }
  }

  private shouldStopEarly(
    successes: Map<Website, CrawlerData>,
    pendingSites: Website[],
    fieldAggregator: FieldAggregator,
  ): boolean {
    if (this.config.download.downloadSceneImages || this.config.download.generateNfo || successes.size === 0) {
      return false;
    }
    const { data, sources } = fieldAggregator.aggregate(successes);
    if (!this.meetsMinimumThreshold(data)) {
      return false;
    }
    if (!sources.title || !this.isWinningSourceFinal("title", sources.title, pendingSites)) {
      return false;
    }
    return EARLY_STOP_IMAGE_FIELDS.some((field) => {
      const winner = sources[field];
      return Boolean(data[field] && winner && this.isWinningSourceFinal(field, winner, pendingSites));
    });
  }

  private meetsMinimumThreshold(data: CrawlerData): boolean {
    return Boolean(data.number && data.title && (data.thumb_url || data.poster_url));
  }

  private isWinningSourceFinal(
    field: "title" | "thumb_url" | "poster_url",
    winner: Website,
    pendingSites: Website[],
  ): boolean {
    const fieldPriorities = this.config.aggregation.fieldPriorities as Partial<Record<string, Website[]>>;
    const priorityOrder = fieldPriorities[field] ?? this.config.scrape.sites;
    const winnerRank = priorityOrder.indexOf(winner);
    if (winnerRank === -1) {
      return pendingSites.length === 0;
    }
    return pendingSites.every((site) => {
      const siteRank = priorityOrder.indexOf(site);
      return siteRank === -1 || siteRank > winnerRank;
    });
  }

  private buildKey(number: string, manualScrape?: ManualScrapeOptions): string {
    const mode = manualScrape ? "manual" : "auto";
    const site = manualScrape?.site ?? "";
    const detailUrl = manualScrape?.detailUrl ?? "";
    return `${number.trim().toUpperCase()}::${mode}::${site}::${detailUrl}`;
  }
}
