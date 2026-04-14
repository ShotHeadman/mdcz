import { ProxyType, type Website } from "@shared/enums";
import type { Configuration } from "./models";

export interface ComputedConfiguration {
  proxyUrl?: string;
  networkTimeoutMs: number;
  networkRetryCount: number;
  enabledSites: Set<Website>;
  orderedSites: Website[];
}

const normalizeProxyUrl = (configuration: Configuration): string | undefined => {
  if (!configuration.network.useProxy) {
    return undefined;
  }

  const proxy = configuration.network.proxy.trim();
  if (!proxy) {
    return undefined;
  }

  const proxyType = configuration.network.proxyType;
  if (proxyType === ProxyType.NONE) {
    return undefined;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(proxy)) {
    return proxy;
  }

  return `${proxyType}://${proxy}`;
};

export const buildComputedConfiguration = (configuration: Configuration): ComputedConfiguration => {
  const proxyUrl = normalizeProxyUrl(configuration);

  const orderedSites = [...new Set(configuration.scrape.sites)];
  const enabledSites = new Set(orderedSites);

  return {
    proxyUrl,
    networkTimeoutMs: Math.max(1, Math.trunc(configuration.network.timeout * 1000)),
    networkRetryCount: Math.max(0, Math.trunc(configuration.network.retryCount)),
    enabledSites,
    orderedSites,
  };
};

export class ComputedConfig {
  private cache: ComputedConfiguration | null = null;

  constructor(private readonly getConfiguration: () => Configuration) {}

  get value(): ComputedConfiguration {
    if (!this.cache) {
      this.cache = buildComputedConfiguration(this.getConfiguration());
    }

    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }
}
