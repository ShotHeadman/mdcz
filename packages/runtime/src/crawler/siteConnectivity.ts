import { type Configuration, isMirrorableSite, type MirrorableSite, resolveSiteUrl } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { SiteConnectivityProbeResponse } from "@mdcz/shared/serverDtos";
import { buildCrawlerOptions } from "../scrape/crawlerOptions";
import { toErrorMessage } from "../shared";

interface SiteConnectivityNetworkClient {
  probe(
    url: string,
    init?: {
      headers?: Record<string, string>;
      timeout?: number;
    },
  ): Promise<{
    ok: boolean;
    status: number;
    resolvedUrl: string;
  }>;
}

const DEFAULT_SITE_CONNECTIVITY_URLS: Record<Exclude<Website, MirrorableSite>, string> = {
  [Website.DAHLIA]: "https://dahlia-av.jp",
  [Website.DMM]: "https://www.dmm.co.jp/",
  [Website.DMM_TV]: "https://video.dmm.co.jp/",
  [Website.FALENO]: "https://faleno.jp",
  [Website.FANTIA]: "https://fantia.jp",
  [Website.FC2]: "https://adult.contents.fc2.com",
  [Website.FC2HUB]: "https://javten.com",
  [Website.H0930]: "https://www.h0930.com",
  [Website.H4610]: "https://www.h4610.com",
  [Website.PPVDATABANK]: "https://ppvdatabank.com",
  [Website.JAV321]: "https://www.jav321.com",
  [Website.KINGDOM]: "https://kingdom.vc",
  [Website.KM_PRODUCE]: "https://www.km-produce.com",
  [Website.MGSTAGE]: "https://www.mgstage.com",
  [Website.PRESTIGE]: "https://www.prestige-av.com",
  [Website.R18_DEV]: "https://r18.dev",
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

export const resolveSiteConnectivityTargetUrl = (site: Website, configuration: Configuration): string =>
  isMirrorableSite(site) ? resolveSiteUrl(configuration.network, site) : DEFAULT_SITE_CONNECTIVITY_URLS[site];

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
  networkClient: SiteConnectivityNetworkClient,
): Promise<SiteConnectivityProbeResponse> => {
  const url = resolveSiteConnectivityTargetUrl(site, configuration);
  const headers = buildSiteConnectivityHeaders(site, configuration);
  const timeout = Math.max(1, Math.trunc(configuration.network.timeout * 1000));
  const startedAt = Date.now();

  try {
    const result = await networkClient.probe(url, {
      timeout,
      headers,
    });
    return {
      ok: result.ok,
      latencyMs: Date.now() - startedAt,
      status: result.status,
      resolvedUrl: result.resolvedUrl,
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: toErrorMessage(error) };
  }
};
