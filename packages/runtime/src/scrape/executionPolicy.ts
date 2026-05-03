import type { Configuration } from "@mdcz/shared/config";
import type { RuntimeNetworkClient } from "../network";
import { createScrapeRestGate, type ScrapeRestGate, type ScrapeRestGateLogger } from "./restGate";

export interface ScrapeNetworkPolicyClient {
  setDomainInterval(domain: string, intervalMs: number, intervalCap?: number, concurrency?: number): void;
  setDomainLimit(domain: string, requestsPerSecond: number, concurrency?: number): void;
  clearDomainLimit?(domain: string): void;
}

export interface ScrapeNetworkPolicyRule {
  domains: readonly string[];
  delaySeconds: (configuration: Configuration) => number;
  intervalCap?: number;
  concurrency?: number;
}

export interface ScrapeExecutionPolicy {
  concurrency: number;
  restGate: ScrapeRestGate | null;
}

export const SCRAPE_NETWORK_POLICY_RULES: readonly ScrapeNetworkPolicyRule[] = [
  {
    domains: ["javdb.com", "www.javdb.com"],
    delaySeconds: (configuration) => configuration.scrape.javdbDelaySeconds,
    intervalCap: 1,
    concurrency: 1,
  },
];

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
  rules: readonly ScrapeNetworkPolicyRule[] = SCRAPE_NETWORK_POLICY_RULES,
): void => {
  if (!hasScrapeNetworkPolicyApi(networkClient)) {
    return;
  }

  for (const rule of rules) {
    const delaySeconds = Math.max(0, Math.trunc(rule.delaySeconds(configuration)));
    for (const domain of rule.domains) {
      if (delaySeconds > 0) {
        networkClient.setDomainInterval(domain, delaySeconds * 1000, rule.intervalCap ?? 1, rule.concurrency ?? 1);
        continue;
      }

      networkClient.clearDomainLimit?.(domain);
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
