import { Website } from "./enums";

export const MANUAL_SCRAPE_INVALID_URL_MESSAGE = "请输入有效的网址";
export const MANUAL_SCRAPE_UNSUPPORTED_SITE_MESSAGE = "不支持的站点地址";
export const MANUAL_SCRAPE_SUPPORTED_SITE_INVALID_MESSAGE = "请输入站点首页或详情地址";

export type ManualScrapeUrlMode = "site" | "detail";

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
      reason: "invalid_url" | "unsupported_site" | "unsupported_path";
      message: string;
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
    site: Website.PPVDATABANK,
    hosts: ["ppvdatabank.com", "www.ppvdatabank.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/article\/\d+\/?$/iu),
  },
  {
    site: Website.JAV321,
    hosts: ["www.jav321.com", "jav321.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/video\/[^/]+\/?$/iu),
  },
  {
    site: Website.JAVBUS,
    hosts: ["www.javbus.com", "javbus.com"],
    isDetailUrl: (url) => pathMatches(url, /^\/(?!search\/?$|genre\/?$|star\/?$)[A-Z0-9_-]+\/?$/iu),
  },
  {
    site: Website.JAVDB,
    hosts: ["javdb.com", "www.javdb.com"],
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

export const validateManualScrapeUrl = (input: string): ManualScrapeUrlValidation => {
  const url = parseInputUrl(input);
  if (!url) {
    return {
      valid: false,
      reason: "invalid_url",
      message: MANUAL_SCRAPE_INVALID_URL_MESSAGE,
    };
  }

  const host = url.hostname.toLowerCase();
  const rule = SITE_RULES.find((candidate) => candidate.hosts.includes(host));
  if (!rule) {
    return {
      valid: false,
      reason: "unsupported_site",
      message: MANUAL_SCRAPE_UNSUPPORTED_SITE_MESSAGE,
    };
  }

  const isRoot = isSiteRootUrl(url);
  const normalizedUrl = normalizeManualUrl(url);
  if (isRoot) {
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

  return {
    valid: false,
    reason: "unsupported_path",
    message: MANUAL_SCRAPE_SUPPORTED_SITE_INVALID_MESSAGE,
  };
};
