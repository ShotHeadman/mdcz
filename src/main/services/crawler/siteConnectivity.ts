import type { Configuration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import { buildCrawlerOptions } from "@main/services/scraper/crawlerOptions";
import { toErrorMessage } from "@main/utils/common";
import { Website } from "@shared/enums";

const DEFAULT_SITE_CONNECTIVITY_URLS: Record<Website, string> = {
  [Website.DAHLIA]: "https://dahlia-av.jp",
  [Website.DMM]: "https://www.dmm.co.jp/",
  [Website.DMM_TV]: "https://video.dmm.co.jp/",
  [Website.FALENO]: "https://faleno.jp",
  [Website.FC2]: "https://adult.contents.fc2.com",
  [Website.FC2HUB]: "https://javten.com",
  [Website.PPVDATABANK]: "https://ppvdatabank.com",
  [Website.JAV321]: "https://www.jav321.com",
  [Website.JAVBUS]: "https://www.javbus.com",
  [Website.JAVDB]: "https://javdb.com",
  [Website.KINGDOM]: "https://kingdom.vc",
  [Website.KM_PRODUCE]: "https://www.km-produce.com",
  [Website.MGSTAGE]: "https://www.mgstage.com",
  [Website.PRESTIGE]: "https://www.prestige-av.com",
  [Website.SOKMIL]: "https://www.sokmil.com",
  [Website.AVBASE]: "https://www.avbase.net",
  [Website.AVWIKIDB]: "https://avwikidb.com",
};

const appendCookie = (headers: Record<string, string>, cookie: string | undefined): void => {
  const normalized = cookie?.trim();
  if (!normalized) {
    return;
  }

  headers.cookie = headers.cookie ? `${headers.cookie}; ${normalized}` : normalized;
};

const formatLatency = (latencyMs: number): string => `${Math.max(0, Math.trunc(latencyMs))}ms`;

export interface SiteConnectivityProbeResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  status?: number;
  resolvedUrl?: string;
}

export const resolveSiteConnectivityTargetUrl = (site: Website, configuration: Configuration): string => {
  const customUrl = buildCrawlerOptions({ site, configuration }).customUrl?.trim();
  if (customUrl) {
    return customUrl;
  }

  return DEFAULT_SITE_CONNECTIVITY_URLS[site];
};

export const buildSiteConnectivityHeaders = (site: Website, configuration: Configuration): Record<string, string> => {
  const headers: Record<string, string> = {};
  const crawlerOptions = buildCrawlerOptions({ site, configuration });
  appendCookie(headers, crawlerOptions.cookies);

  if (site === Website.MGSTAGE) {
    appendCookie(headers, "adc=1");
  }

  if (site === Website.SOKMIL) {
    appendCookie(headers, "AGEAUTH=ok");
  }

  return headers;
};

export const probeSiteConnectivity = async (
  site: Website,
  configuration: Configuration,
  networkClient: Pick<NetworkClient, "probe">,
): Promise<SiteConnectivityProbeResult> => {
  const url = resolveSiteConnectivityTargetUrl(site, configuration);
  const headers = buildSiteConnectivityHeaders(site, configuration);
  const timeout = Math.max(1, Math.trunc(configuration.network.timeout * 1000));
  const startedAt = Date.now();

  try {
    const result = await networkClient.probe(url, {
      timeout,
      headers,
    });
    const latencyMs = Date.now() - startedAt;
    const baseMessage = `HTTP ${result.status} · ${formatLatency(latencyMs)}`;

    return {
      ok: result.ok,
      message: result.ok ? baseMessage : `连接异常 · ${baseMessage}`,
      latencyMs,
      status: result.status,
      resolvedUrl: result.resolvedUrl,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    return {
      ok: false,
      message: `请求失败: ${toErrorMessage(error)}`,
      latencyMs,
    };
  }
};
