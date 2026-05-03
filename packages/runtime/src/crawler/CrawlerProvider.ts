import type { SiteRequestConfigRegistrar } from "@mdcz/runtime/network";
import { runtimeLoggerService, toErrorMessage } from "@mdcz/runtime/shared";
import { Website } from "@mdcz/shared/enums";

import type { AdapterDependencies, CrawlerInput, CrawlerResponse, SiteAdapter } from "./base/types";
import type { FetchGateway } from "./FetchGateway";
import { getCrawlerConstructor, listRegisteredCrawlerRequestConfigs, listRegisteredCrawlerSites } from "./registry";

export interface CrawlerProviderOptions {
  fetchGateway: FetchGateway;
  siteCooldownStore?: RuntimeCooldownStore;
  siteRequestConfigRegistrar?: SiteRequestConfigRegistrar;
}

export interface RuntimeCooldownEntry {
  failureCount: number;
  lastFailureAt: number;
  cooldownUntil: number | null;
  expiresAt: number | null;
}

export interface CooldownFailurePolicy {
  threshold: number;
  windowMs: number;
  cooldownMs: number;
}

export interface RuntimeActiveCooldown {
  failureCount: number;
  lastFailureAt: number;
  cooldownUntil: number;
  remainingMs: number;
}

export interface RuntimeCooldownStore {
  isCoolingDown(key: string, now?: number): boolean;
  getActiveCooldown(key: string, now?: number): RuntimeActiveCooldown | undefined;
  open(key: string, cooldownMs: number, failureCount?: number): RuntimeCooldownEntry;
  recordFailure(key: string, policy: CooldownFailurePolicy): RuntimeCooldownEntry;
  reset(key: string): void;
  flush(): Promise<void>;
}

class MemoryCooldownStore implements RuntimeCooldownStore {
  private readonly entries = new Map<string, RuntimeCooldownEntry>();

  isCoolingDown(key: string, now = Date.now()): boolean {
    return Boolean(this.getActiveCooldown(key, now));
  }

  getActiveCooldown(key: string, now = Date.now()): RuntimeActiveCooldown | undefined {
    const entry = this.entries.get(key);
    if (!entry?.cooldownUntil || entry.cooldownUntil <= now) {
      return undefined;
    }
    return {
      failureCount: entry.failureCount,
      lastFailureAt: entry.lastFailureAt,
      cooldownUntil: entry.cooldownUntil,
      remainingMs: Math.max(0, entry.cooldownUntil - now),
    };
  }

  open(key: string, cooldownMs: number, failureCount = 1): RuntimeCooldownEntry {
    const now = Date.now();
    const entry = {
      cooldownUntil: now + Math.max(1, Math.trunc(cooldownMs)),
      expiresAt: now + Math.max(1, Math.trunc(cooldownMs)),
      failureCount: Math.max(1, Math.trunc(failureCount)),
      lastFailureAt: now,
    };
    this.entries.set(key, entry);
    return entry;
  }

  recordFailure(key: string, policy: CooldownFailurePolicy): RuntimeCooldownEntry {
    const now = Date.now();
    const current = this.entries.get(key);
    const recentFailureCount = current && now - current.lastFailureAt <= policy.windowMs ? current.failureCount : 0;
    const failureCount = recentFailureCount + 1;
    const cooldownUntil = failureCount >= policy.threshold ? now + policy.cooldownMs : null;
    const entry = {
      cooldownUntil,
      expiresAt: cooldownUntil ?? now + policy.windowMs,
      failureCount,
      lastFailureAt: now,
    };
    this.entries.set(key, entry);
    return entry;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  async flush(): Promise<void> {
    return;
  }
}

const SITE_COOLDOWN_MS = 5 * 60 * 1000;
const TRANSIENT_SITE_FAILURE_POLICY: CooldownFailurePolicy = {
  threshold: 2,
  windowMs: SITE_COOLDOWN_MS,
  cooldownMs: SITE_COOLDOWN_MS,
};
const DETERMINISTIC_FAILURE_PATTERNS = [/http 403\b/iu, /\bforbidden\b/iu, /region blocked/iu, /login wall/iu];
const TRANSIENT_FAILURE_PATTERNS = [
  /timeout/iu,
  /timed out/iu,
  /\betimedout\b/iu,
  /\babort(?:ed)?\b/iu,
  /tls handshake eof/iu,
  /\beconnreset\b/iu,
  /socket hang up/iu,
  /http 429\b/iu,
  /http 5\d\d\b/iu,
];
type CooldownFailureKind = "deterministic" | "transient" | "ignore";

const formatCooldownDetails = (cooldownUntil: number, remainingMs: number): string =>
  `${remainingMs}ms remaining until ${new Date(cooldownUntil).toISOString()}`;

export class CrawlerProvider {
  private readonly logger = runtimeLoggerService.getLogger("CrawlerProvider");

  private readonly dependencies: AdapterDependencies;

  private readonly cache = new Map<Website, SiteAdapter>();

  private readonly siteCooldownStore: RuntimeCooldownStore;

  constructor(options: CrawlerProviderOptions) {
    this.dependencies = {
      gateway: options.fetchGateway,
    };
    this.siteCooldownStore = options.siteCooldownStore ?? new MemoryCooldownStore();
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

  async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    const startedAt = Date.now();
    const activeCooldown = this.siteCooldownStore.getActiveCooldown(input.site);

    if (activeCooldown) {
      return {
        input,
        result: {
          success: false,
          error: `Crawler for site '${input.site}' is temporarily unavailable (site cooldown active: ${formatCooldownDetails(
            activeCooldown.cooldownUntil,
            activeCooldown.remainingMs,
          )})`,
          failureReason: "timeout",
        },
        elapsedMs: Date.now() - startedAt,
      };
    }

    const crawler = this.getCrawler(input.site);
    if (!crawler) {
      return {
        input,
        result: {
          success: false,
          error: `Crawler for site '${input.site}' is not implemented in Node.js`,
          failureReason: "unknown",
        },
        elapsedMs: Date.now() - startedAt,
      };
    }

    try {
      const response = await crawler.crawl(input);

      this.updateSiteCooldown(input.site, response.result);

      return response;
    } catch (error) {
      const message = toErrorMessage(error);
      this.recordSiteCooldownFailure(input.site, "unknown", message);
      this.logger.warn(`Crawler threw for ${input.site}: ${message}`);

      return {
        input,
        result: {
          success: false,
          error: message,
          failureReason: "unknown",
          cause: error,
        },
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  isSiteCoolingDown(site: Website): boolean {
    return this.siteCooldownStore.isCoolingDown(site);
  }

  getSiteCooldown(site: Website) {
    return this.siteCooldownStore.getActiveCooldown(site);
  }

  listSites(): { site: Website; native: boolean }[] {
    const nativeSites = new Set(listRegisteredCrawlerSites());

    return (Object.values(Website) as Website[]).map((site) => ({
      site,
      native: nativeSites.has(site),
    }));
  }

  async shutdown(): Promise<void> {
    await this.siteCooldownStore.flush();
  }

  private updateSiteCooldown(site: Website, result: CrawlerResponse["result"]): void {
    if (result.success || result.failureReason === "not_found") {
      this.siteCooldownStore.reset(site);
      return;
    }

    this.recordSiteCooldownFailure(site, result.failureReason ?? "unknown", result.error);
  }

  private classifyCooldownFailure(failureReason: string, errorMessage?: string): CooldownFailureKind {
    const message = errorMessage ?? "";

    if (
      failureReason === "region_blocked" ||
      failureReason === "login_wall" ||
      DETERMINISTIC_FAILURE_PATTERNS.some((pattern) => pattern.test(message))
    ) {
      return "deterministic";
    }

    if (failureReason === "timeout" || TRANSIENT_FAILURE_PATTERNS.some((pattern) => pattern.test(message))) {
      return "transient";
    }

    return "ignore";
  }

  private recordSiteCooldownFailure(site: Website, failureReason: string, errorMessage?: string): void {
    const failureKind = this.classifyCooldownFailure(failureReason, errorMessage);
    if (failureKind === "ignore") {
      return;
    }

    const state =
      failureKind === "deterministic"
        ? this.siteCooldownStore.open(site, SITE_COOLDOWN_MS)
        : this.siteCooldownStore.recordFailure(site, TRANSIENT_SITE_FAILURE_POLICY);

    if (state?.cooldownUntil) {
      this.logger.warn(
        `Site cooldown opened for ${site} for ${SITE_COOLDOWN_MS}ms (${formatCooldownDetails(
          state.cooldownUntil,
          Math.max(0, state.cooldownUntil - Date.now()),
        )}) after ${
          failureKind === "deterministic" ? "deterministic failure" : `${state.failureCount} transient failures`
        }`,
      );
    }
  }
}
