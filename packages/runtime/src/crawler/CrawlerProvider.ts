import { SiteError, type SiteRequestConfigRegistrar } from "@mdcz/runtime/network";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerSiteInfoDto } from "@mdcz/shared/serverDtos";
import {
  type FailureReason,
  MOVIE_FACT_FAILURE_REASONS,
  type SiteHealth,
  UNAVAILABLE_FAILURE_REASONS,
} from "@mdcz/shared/siteResults";
import { toCrawlerErrorResult } from "./base/BaseCrawler";
import type { AdapterDependencies, CrawlerInput, CrawlerResponse, CrawlerResult, SiteAdapter } from "./base/types";
import type { FetchGateway } from "./FetchGateway";
import { getCrawlerConstructor, listRegisteredCrawlerRequestConfigs, listRegisteredCrawlerSites } from "./registry";

export interface CrawlerProviderOptions {
  fetchGateway: FetchGateway;
  siteRequestConfigRegistrar?: SiteRequestConfigRegistrar;
  /** Identifies the proxy and credentials a site is reached with; a change lifts the site's unavailability. */
  getSiteNetworkKey?: (site: Website) => string;
}

interface SitePause {
  reason: FailureReason;
  /** Absent for unavailability, which lasts until the network key changes, a check passes, or the app restarts. */
  until?: number;
  networkKey?: string;
}

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_RETRY_AFTER_MS = 60 * 60_000;
const TRANSIENT_FAILURE_THRESHOLD = 3;
const TRANSIENT_FAILURE_WINDOW_MS = 5 * 60_000;
const TRANSIENT_COOLDOWN_MS = 60_000;

const isTransientFailure = (result: Extract<CrawlerResult, { success: false }>): boolean =>
  result.reason === "timeout" ||
  result.reason === "network_error" ||
  (result.reason === "http_error" && (result.httpStatus ?? 0) >= 500);

export class CrawlerProvider {
  private readonly logger = runtimeLoggerService.getLogger("CrawlerProvider");

  private readonly dependencies: AdapterDependencies;

  private readonly cache = new Map<Website, SiteAdapter>();

  private readonly pauses = new Map<Website, SitePause>();

  private readonly transientFailures = new Map<Website, { count: number; lastAt: number }>();

  private readonly getSiteNetworkKey?: (site: Website) => string;

  constructor(options: CrawlerProviderOptions) {
    this.dependencies = { gateway: options.fetchGateway };
    this.getSiteNetworkKey = options.getSiteNetworkKey;
    options.siteRequestConfigRegistrar?.registerSiteRequestConfigs(listRegisteredCrawlerRequestConfigs());
  }

  getCrawler(site: Website): SiteAdapter | null {
    const cached = this.cache.get(site);
    if (cached) {
      return cached;
    }

    const crawlerConstructor = getCrawlerConstructor(site);
    if (!crawlerConstructor) {
      return null;
    }

    const crawler = new crawlerConstructor(this.dependencies);
    this.cache.set(site, crawler);
    return crawler;
  }

  /** Crawls regardless of pauses; callers that respect them consult `getSiteHealth` first. */
  async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    const startedAt = Date.now();
    const crawler = this.getCrawler(input.site);
    if (!crawler) {
      return {
        input,
        result: { success: false, error: `Crawler for site '${input.site}' is not implemented`, reason: "unknown" },
        elapsedMs: Date.now() - startedAt,
      };
    }

    let response: CrawlerResponse;
    try {
      response = await crawler.crawl(input);
    } catch (error) {
      response = { input, result: toCrawlerErrorResult(error), elapsedMs: Date.now() - startedAt };
    }
    // A caller-imposed budget aborts the crawl with the typed reason it ran out for.
    const abortReason = input.options?.signal?.reason;
    if (!response.result.success && abortReason instanceof SiteError) {
      response = {
        ...response,
        result: { ...response.result, reason: abortReason.reason, error: abortReason.message },
      };
    }
    this.recordOutcome(input.site, response.result);
    return response;
  }

  getSiteHealth(site: Website): SiteHealth | undefined {
    const pause = this.pauses.get(site);
    if (!pause) return undefined;
    const expired =
      pause.until === undefined
        ? this.getSiteNetworkKey !== undefined && pause.networkKey !== this.getSiteNetworkKey(site)
        : pause.until <= Date.now();
    if (expired) {
      this.pauses.delete(site);
      return undefined;
    }
    return { reason: pause.reason, until: pause.until };
  }

  resetSite(site: Website): void {
    this.pauses.delete(site);
    this.transientFailures.delete(site);
  }

  listSites(enabledSites: readonly Website[]): CrawlerSiteInfoDto[] {
    const nativeSites = new Set(listRegisteredCrawlerSites());
    const enabled = new Set(enabledSites);
    return Object.values(Website).map((site) => ({
      site,
      name: site,
      enabled: enabled.has(site),
      native: nativeSites.has(site),
      health: this.getSiteHealth(site),
    }));
  }

  private recordOutcome(site: Website, result: CrawlerResult): void {
    if (result.success || MOVIE_FACT_FAILURE_REASONS.has(result.reason)) {
      // A login wall may cover only some titles (JavDB's FC2 and uncensored pages), so an answer for another title
      // doesn't prove the credential works.
      if (this.pauses.get(site)?.reason === "login_wall") {
        this.transientFailures.delete(site);
        return;
      }
      this.resetSite(site);
      return;
    }

    const now = Date.now();
    if (UNAVAILABLE_FAILURE_REASONS.has(result.reason)) {
      const current = this.pauses.get(site);
      if (current?.until === undefined && current?.reason === result.reason) return;
      this.pauses.set(site, { reason: result.reason, networkKey: this.getSiteNetworkKey?.(site) });
      this.logger.warn(`${site} is unavailable on this network (${result.reason}): ${result.error}`);
      return;
    }

    if (result.reason === "rate_limited") {
      const cooldownMs = Math.min(result.retryAfterMs ?? RATE_LIMIT_COOLDOWN_MS, MAX_RETRY_AFTER_MS);
      this.pauses.set(site, { reason: result.reason, until: now + cooldownMs });
      this.logger.warn(`${site} rate limited; paused for ${cooldownMs}ms`);
      return;
    }

    if (!isTransientFailure(result)) return;
    const previous = this.transientFailures.get(site);
    const count = previous && now - previous.lastAt <= TRANSIENT_FAILURE_WINDOW_MS ? previous.count + 1 : 1;
    if (count < TRANSIENT_FAILURE_THRESHOLD) {
      this.transientFailures.set(site, { count, lastAt: now });
      return;
    }
    this.transientFailures.delete(site);
    this.pauses.set(site, { reason: result.reason, until: now + TRANSIENT_COOLDOWN_MS });
    this.logger.warn(
      `${site} paused for ${TRANSIENT_COOLDOWN_MS}ms after ${count} consecutive ${result.reason} failures`,
    );
  }
}
