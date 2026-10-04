import { type Configuration, OFFICIAL_SITE_HOSTS, resolveSiteUrl } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { RuntimeNetworkClient } from "../network";
import { createScrapeRestGate, type ScrapeRestGate, type ScrapeRestGateLogger } from "./restGate";

export interface ScrapeNetworkPolicyClient {
  setDomainInterval(domain: string, intervalMs: number, intervalCap?: number, concurrency?: number): void;
  setDomainLimit(domain: string, requestsPerSecond: number, concurrency?: number): void;
  clearDomainLimit?(domain: string): void;
}

export interface ScrapeExecutionPolicy {
  concurrency: number;
  restGate: ScrapeRestGate | null;
}

const hasScrapeNetworkPolicyApi = (
  client: RuntimeNetworkClient | ScrapeNetworkPolicyClient,
): client is ScrapeNetworkPolicyClient =>
  typeof (client as Partial<ScrapeNetworkPolicyClient>).setDomainInterval === "function" &&
  typeof (client as Partial<ScrapeNetworkPolicyClient>).setDomainLimit === "function";

export const getScrapeConcurrency = (configuration: Configuration): number =>
  Math.max(1, Math.trunc(configuration.scrape.threadNumber));

export const applyScrapeNetworkPolicy = (
  networkClient: RuntimeNetworkClient | ScrapeNetworkPolicyClient,
  configuration: Configuration,
): void => {
  if (!hasScrapeNetworkPolicyApi(networkClient)) {
    return;
  }

  const javdbHosts = new Set([
    ...OFFICIAL_SITE_HOSTS[Website.JAVDB],
    new URL(resolveSiteUrl(configuration.network, Website.JAVDB)).hostname,
  ]);
  const delaySeconds = Math.max(0, Math.trunc(configuration.scrape.javdbDelaySeconds));
  for (const host of javdbHosts) {
    if (delaySeconds > 0) {
      networkClient.setDomainInterval(host, delaySeconds * 1000, 1, 1);
    } else {
      networkClient.clearDomainLimit?.(host);
    }
  }
};

export const createScrapeExecutionPolicy = (
  configuration: Configuration,
  options: { logger?: ScrapeRestGateLogger } = {},
): ScrapeExecutionPolicy => ({
  concurrency: getScrapeConcurrency(configuration),
  restGate: createScrapeRestGate({
    restAfterCount: configuration.scrape.restAfterCount,
    restDurationSeconds: configuration.scrape.restDuration,
    logger: options.logger,
  }),
});
