import { type CooldownFailurePolicy, PersistentCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { Website } from "@shared/enums";

import type { AdapterDependencies, CrawlerInput, CrawlerResponse, SiteAdapter } from "./base/types";
import type { FetchGateway } from "./FetchGateway";
import { getCrawlerConstructor, listRegisteredCrawlerSites } from "./registry";

export interface CrawlerProviderOptions {
  fetchGateway: FetchGateway;
  siteCooldownStore?: PersistentCooldownStore;
}

const SITE_COOLDOWN_MS = 5 * 60 * 1000;
const TRANSIENT_SITE_FAILURE_POLICY: CooldownFailurePolicy = {
  threshold: 2,
  windowMs: SITE_COOLDOWN_MS,
  cooldownMs: SITE_COOLDOWN_MS,
};
const DETERMINISTIC_FAILURE_PATTERNS = [
  /http 403\b/iu,
  /\bforbidden\b/iu,
  /region blocked/iu,
  /login wall/iu,
  /cloudflare challenge/iu,
];
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
  private readonly logger = loggerService.getLogger("CrawlerProvider");

  private readonly dependencies: AdapterDependencies;

  private readonly cache = new Map<Website, SiteAdapter>();

  private readonly siteCooldownStore: PersistentCooldownStore;

  constructor(options: CrawlerProviderOptions) {
    this.dependencies = {
      gateway: options.fetchGateway,
    };
    this.siteCooldownStore =
      options.siteCooldownStore ??
      new PersistentCooldownStore({
        fileName: "crawler-site-cooldowns.json",
        loggerName: "CrawlerSiteCooldownStore",
      });
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

  private updateSiteCooldown(site: Website, result: CrawlerResponse["result"]): void {
    if (result.success || result.failureReason === "not_found") {
      this.siteCooldownStore.reset(site);
      return;
    }

    this.recordSiteCooldownFailure(site, result.failureReason ?? "unknown", result.error);
  }

  private classifyCooldownFailure(failureReason: string, errorMessage?: string): CooldownFailureKind {
    if (
      failureReason === "region_blocked" ||
      failureReason === "login_wall" ||
      DETERMINISTIC_FAILURE_PATTERNS.some((pattern) => pattern.test(errorMessage ?? ""))
    ) {
      return "deterministic";
    }

    if (failureReason === "timeout" || TRANSIENT_FAILURE_PATTERNS.some((pattern) => pattern.test(errorMessage ?? ""))) {
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
