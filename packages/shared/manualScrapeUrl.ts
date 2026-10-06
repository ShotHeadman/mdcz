import { isMirrorableSite, OFFICIAL_SITE_HOSTS, resolveSiteUrl, type SiteUrlConfiguration } from "./config";
import { Website } from "./enums";
import { OFFICIAL_MAKERS } from "./officialSites";

export type ManualScrapeUrlMode = "site" | "detail";

export type ManualScrapeUrlInvalidReason = "invalid_url" | "unsupported_site" | "unsupported_path";

const INVALID_REASON_MESSAGES: Record<ManualScrapeUrlInvalidReason, string> = {
  invalid_url: "Enter a valid URL",
  unsupported_site: "Unsupported site URL",
  unsupported_path: "Enter a site home page or detail page URL",
};

export const resolveManualScrapeRoute = (
  url: string | null | undefined,
  network: SiteUrlConfiguration,
): Pick<ManualScrapeUrlRoute, "site" | "detailUrl"> | undefined => {
  if (!url?.trim()) return undefined;
  const validation = validateManualScrapeUrl(url, network);
  if (!validation.valid) throw new Error(INVALID_REASON_MESSAGES[validation.reason]);
  return { site: validation.route.site, detailUrl: validation.route.detailUrl };
};

export interface ManualScrapeUrlRoute {
  site: Website;
  mode: ManualScrapeUrlMode;
  url: string;
  detailUrl?: string;
}

export type ManualScrapeUrlValidation =
  | {
      valid: true;
      route: ManualScrapeUrlRoute;
    }
  | {
      valid: false;
      reason: ManualScrapeUrlInvalidReason;
    };

interface ManualScrapeSiteRule {
  site: Website;
  hosts: readonly string[];
  isDetailUrl?: (url: URL) => boolean;
}

const pathMatches = (url: URL, pattern: RegExp): boolean => pattern.test(url.pathname);
const hasQueryParam = (url: URL, name: string): boolean => Boolean(url.searchParams.get(name)?.trim());

const SITE_RULES: readonly ManualScrapeSiteRule[] = [
  {
    site: Website.OFFICIAL,
    hosts: OFFICIAL_MAKERS.flatMap(({ domain }) => [
      domain,
      domain.startsWith("www.") ? domain.slice(4) : `www.${domain}`,
    ]),
    isDetailUrl: (url) => pathMatches(url, /^\/works\/detail\/[a-z]+\d+\/?$/iu),
  },
  {
    site: Website.ONEPONDO,
    hosts: ["1pondo.tv", "www.1pondo.tv"],
    isDetailUrl: (url) => pathMatches(url, /^\/moviepages\/\d{6}_\d{3}\/index\.html$/iu),
  },
  {
    site: Website.TENMUSUME,
    hosts: ["10musume.com", "www.10musume.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/moviepages\/\d{6}_\d{2}\/index\.html$/iu),
  },
  {
    site: Website.CARIBBEANCOM,
    hosts: ["caribbeancom.com", "www.caribbeancom.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/moviepages\/\d{6}-\d{3}\/index\.html$/iu),
  },
  {
    site: Website.HEYZO,
    hosts: ["heyzo.com", "www.heyzo.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/moviepages\/\d+\/index\.html$/iu),
  },
  {
    site: Website.DMM_TV,
    hosts: ["video.dmm.co.jp", "tv.dmm.co.jp"],
    isDetailUrl: (url) => {
      if (url.hostname.toLowerCase() === "tv.dmm.co.jp") {
        return /^\/list\/?$/iu.test(url.pathname) && hasQueryParam(url, "content");
      }

      return /^\/(?:av|anime)\/content\/?$/iu.test(url.pathname) && hasQueryParam(url, "id");
    },
  },
  {
    site: Website.DMM,
    hosts: ["www.dmm.co.jp", "dmm.co.jp", "www.dmm.com", "dmm.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/(?:digital|mono|monthly|rental)\/.+\/detail\/=\/cid=[^/]+\/?$/iu),
  },
  {
    site: Website.DAHLIA,
    hosts: ["dahlia-av.jp", "www.dahlia-av.jp"],
    isDetailUrl: (url) => pathMatches(url, /^\/works\/[^/]+\/?$/iu),
  },
  {
    site: Website.FALENO,
    hosts: ["faleno.jp", "www.faleno.jp"],
    isDetailUrl: (url) => pathMatches(url, /^\/(?:top\/)?works\/[^/]+\/?$/iu),
  },
  {
    site: Website.FC2,
    hosts: ["adult.contents.fc2.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/article\/\d+\/?$/iu),
  },
  {
    site: Website.FC2HUB,
    hosts: ["javten.com", "www.javten.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/video\/\d+\/[^/]+\/?$/iu),
  },
  {
    site: Website.H0930,
    hosts: ["h0930.com", "www.h0930.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/moviepages\/[a-z\d]+\/index\.html$/iu),
  },
  {
    site: Website.H4610,
    hosts: ["h4610.com", "www.h4610.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/moviepages\/[a-z\d]+\/index\.html$/iu),
  },
  {
    site: Website.PPVDATABANK,
    hosts: ["ppvdatabank.com", "www.ppvdatabank.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/article\/\d+\/?$/iu),
  },
  {
    site: Website.JAV321,
    hosts: ["www.jav321.com", "jav321.com", "en.jav321.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/video\/[^/]+\/?$/iu),
  },
  {
    site: Website.JAVBUS,
    hosts: OFFICIAL_SITE_HOSTS[Website.JAVBUS],
    isDetailUrl: (url) => pathMatches(url, /^\/(?!search\/?$|genre\/?$|star\/?$)[A-Z0-9_-]+\/?$/iu),
  },
  {
    site: Website.JAVDB,
    hosts: OFFICIAL_SITE_HOSTS[Website.JAVDB],
    isDetailUrl: (url) => pathMatches(url, /^\/v\/[^/]+\/?$/iu),
  },
  {
    site: Website.KINGDOM,
    hosts: ["kingdom.vc", "www.kingdom.vc"],
    isDetailUrl: (url) => pathMatches(url, /^\/products\/detail\/\d+\/?$/iu),
  },
  {
    site: Website.KM_PRODUCE,
    hosts: ["www.km-produce.com", "km-produce.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/works\/[^/]+\/?$/iu),
  },
  {
    site: Website.MGSTAGE,
    hosts: ["www.mgstage.com", "mgstage.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/product\/product_detail\/[^/]+\/?$/iu),
  },
  {
    site: Website.PRESTIGE,
    hosts: ["www.prestige-av.com", "prestige-av.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/api\/product\/[^/]+\/?$/iu),
  },
  {
    site: Website.SOKMIL,
    hosts: ["www.sokmil.com", "sokmil.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/[^/]+\/_item\/item\d+\.htm$/iu),
  },
  {
    site: Website.AVBASE,
    hosts: ["www.avbase.net", "avbase.net"],
    isDetailUrl: (url) => pathMatches(url, /^\/works\/[^/]+\/?$/iu),
  },
  {
    site: Website.AVWIKIDB,
    hosts: ["avwikidb.com", "www.avwikidb.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/work\/[^/]+\/?$/iu),
  },
  {
    site: Website.FANTIA,
    hosts: ["fantia.jp", "www.fantia.jp"],
    isDetailUrl: (url) => pathMatches(url, /^\/(?:products|posts)\/[^/]+\/?$/iu),
  },
];

const parseInputUrl = (input: string): URL | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};

const isSiteRootUrl = (url: URL): boolean => {
  const path = url.pathname.replace(/\/+$/u, "");
  return path === "" && url.search === "" && url.hash === "";
};

const normalizeManualUrl = (url: URL): string => {
  url.hash = "";
  return url.toString();
};

export const validateManualScrapeUrl = (input: string, network: SiteUrlConfiguration): ManualScrapeUrlValidation => {
  const url = parseInputUrl(input);
  if (!url) {
    return { valid: false, reason: "invalid_url" };
  }

  const host = url.hostname.toLowerCase();
  const rule =
    SITE_RULES.find(
      (candidate) => isMirrorableSite(candidate.site) && resolveSiteUrl(network, candidate.site) === url.origin,
    ) ?? SITE_RULES.find((candidate) => candidate.hosts.includes(host));
  if (!rule) {
    return { valid: false, reason: "unsupported_site" };
  }

  const isRoot = isSiteRootUrl(url);
  if (isRoot) {
    const normalizedUrl = normalizeManualUrl(url);
    return {
      valid: true,
      route: {
        site: rule.site,
        mode: "site",
        url: normalizedUrl,
      },
    };
  }

  if (rule.isDetailUrl?.(url)) {
    if (rule.site === Website.JAV321 && host === "en.jav321.com") {
      url.hostname = "www.jav321.com";
    }
    const normalizedUrl = normalizeManualUrl(url);
    return {
      valid: true,
      route: {
        site: rule.site,
        mode: "detail",
        url: normalizedUrl,
        detailUrl: normalizedUrl,
      },
    };
  }

  return { valid: false, reason: "unsupported_path" };
};
