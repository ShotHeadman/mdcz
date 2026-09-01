import type { Configuration } from "@mdcz/shared/config";
import { ProxyType, type Website } from "@mdcz/shared/enums";

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

  return {
    proxyUrl,
    networkTimeoutMs: Math.max(1, Math.trunc(configuration.network.timeout * 1000)),
    networkRetryCount: Math.max(0, Math.trunc(configuration.network.retryCount)),
    enabledSites: new Set(orderedSites),
    orderedSites,
  };
};
