import type { SiteRequestConfig } from "@mdcz/runtime/network";
import {
  classifyJavbusPage,
  JAVBUS_OFFICIAL_REQUEST_HEADERS,
  JAVBUS_PAGE_HEADERS,
  javbusBlockedPageMessage,
  normalizeCode,
  normalizeText,
} from "@mdcz/runtime/shared";
import { OFFICIAL_SITE_URLS } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { extractText, parseDate } from "../base/parser";
import type { Context } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { extractParentTextByLabelSelector, toAbsoluteUrl } from "./helpers";

const JAVBUS_SITE_REQUEST_CONFIGS: readonly SiteRequestConfig[] = [
  {
    id: "crawler:javbus",
    matches: (url) => url.hostname === "javbus.com" || url.hostname.endsWith(".javbus.com"),
    headers: JAVBUS_OFFICIAL_REQUEST_HEADERS,
  },
];

type CheerioInput = Parameters<CheerioAPI>[0];
type JavbusSearchResult = { detailUrl: string; matched: boolean };

const buildPosterUrl = (thumbUrl: string | undefined): string | undefined => {
  if (!thumbUrl) {
    return undefined;
  }

  if (thumbUrl.includes("/pics/")) {
    return thumbUrl.replace("/cover/", "/thumb/").replace("_b.jpg", ".jpg");
  }

  if (thumbUrl.includes("/imgs/")) {
    return thumbUrl.replace("/cover/", "/thumbs/").replace("_b.jpg", ".jpg");
  }

  return undefined;
};

const normalizeSearchResultPath = (href: string): string => {
  return normalizeCode(href.split(/[?#]/u)[0] ?? href);
};

const pickJavbusSearchResult = (
  searchUrl: string,
  candidateHrefs: string[],
  expectedNumber: string,
): JavbusSearchResult => {
  const expected = normalizeCode(expectedNumber);
  const fallbackDetailUrl = new URL(`/${encodeURIComponent(expectedNumber.toUpperCase())}`, searchUrl).href;
  const href = candidateHrefs.find((candidate) => normalizeSearchResultPath(candidate).endsWith(`/${expected}`));

  return href
    ? { detailUrl: new URL(href, searchUrl).href, matched: true }
    : { detailUrl: fallbackDetailUrl, matched: false };
};

export class JavbusCrawler extends BaseCrawler {
  static readonly siteRequestConfigs = JAVBUS_SITE_REQUEST_CONFIGS;

  site(): Website {
    return Website.JAVBUS;
  }

  protected override buildHeaders(context: Context): Record<string, string> {
    return { ...JAVBUS_PAGE_HEADERS, ...super.buildHeaders(context) };
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = normalizeText(context.number);
    if (!number) {
      return null;
    }

    return `${context.options.baseUrl ?? OFFICIAL_SITE_URLS[Website.JAVBUS]}/search/${encodeURIComponent(number)}`;
  }

  protected async parseSearchPage(context: Context, $: CheerioAPI, searchUrl: string): Promise<string | null> {
    const blockedMessage = javbusBlockedPageMessage(classifyJavbusPage($.html()));
    if (blockedMessage) {
      throw new Error(blockedMessage);
    }

    const candidates = $("a.movie-box")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => typeof href === "string" && href.length > 0);

    const result = pickJavbusSearchResult(searchUrl, candidates, context.number);
    if (!result.matched) {
      this.logger.debug(
        `No javbus search match for ${context.number} via ${searchUrl}, fallback to ${result.detailUrl}`,
      );
    }

    return result.detailUrl;
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, detailUrl: string): Promise<CrawlerData | null> {
    const titleRaw = extractText($, "h3");
    if (!titleRaw) {
      return null;
    }

    const number = extractParentTextByLabelSelector($, "span.header", ["識別碼", "识别码", "ID"]) ?? context.number;
    const release =
      parseDate(extractParentTextByLabelSelector($, "span.header", ["發行日期", "发行日期", "Released"])) ?? undefined;

    const actors = $("div.star-name a")
      .map((_index: number, element: CheerioInput) => $(element).text().trim())
      .get()
      .filter((name: string) => name.length > 0);

    const genres = $("span.genre label a[href*='/genre/']")
      .map((_index: number, element: CheerioInput) => $(element).text().trim())
      .get()
      .filter((name: string) => name.length > 0);

    const thumbUrl = $("a.bigImage").first().attr("href") ?? undefined;
    const thumbUrlAbsolute = toAbsoluteUrl(detailUrl, thumbUrl);
    const posterUrl = buildPosterUrl(thumbUrlAbsolute);

    const studio = $("a[href*='/studio/']").first().text().trim() || undefined;
    const publisherText = $("a[href*='/label/']").first().text().trim();
    const publisher = publisherText.length > 0 ? publisherText : studio;
    const director = $("a[href*='/director/']").first().text().trim() || undefined;
    const series = $("a[href*='/series/']").first().text().trim() || undefined;

    const sceneImageUrls = $("#sample-waterfall a")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => typeof href === "string" && href.length > 0)
      .map((href: string) => toAbsoluteUrl(detailUrl, href))
      .filter((href): href is string => Boolean(href));

    const title = titleRaw.replace(number, "").trim();

    return {
      title,
      number,
      actors,
      genres,
      studio,
      director,
      publisher,
      series,
      plot: undefined,
      release_date: release,
      rating: undefined,
      thumb_url: thumbUrlAbsolute,
      poster_url: posterUrl,
      fanart_url: undefined,
      scene_images: sceneImageUrls,
      trailer_url: undefined,
      website: Website.JAVBUS,
    };
  }

  protected override classifyDetailFailure(_context: Context, detailHtml: string): string | null {
    return javbusBlockedPageMessage(classifyJavbusPage(detailHtml));
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.JAVBUS,
  crawler: JavbusCrawler,
};
