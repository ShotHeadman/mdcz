import { failureReasonOf, SiteError, type SiteRequestConfig } from "@mdcz/runtime/network";
import {
  classifyJavbusPage,
  JAVBUS_OFFICIAL_REQUEST_HEADERS,
  JAVBUS_PAGE_HEADERS,
  normalizeText,
} from "@mdcz/runtime/shared";
import { OFFICIAL_SITE_URLS } from "@mdcz/shared/config";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";
import type { ContentType } from "../../scrape/utils/movieClassification";
import { BaseCrawler } from "../base/BaseCrawler";
import { movieNumbersMatch, toDateSequenceLabel } from "../base/identity";
import { extractText, parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
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

const javbusNumber = (number: string): string => toDateSequenceLabel(number) ?? number.toUpperCase();

const javbusBlockedPageError = (html: string): SiteError | null => {
  const page = classifyJavbusPage(html);
  if (page === "verification_required") {
    return new SiteError(
      "login_wall",
      "JavBus requires age/region verification. Complete it in your browser and copy the cookies; forum registration does not resolve this.",
    );
  }
  if (page === "login_wall") {
    return new SiteError("login_wall", "JavBus login wall; the current cookie cannot access film content.");
  }
  return null;
};

export class JavbusCrawler extends BaseCrawler {
  static readonly contentTypes: readonly ContentType[] = ["censored", "uncensored"];
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

    return `${context.options.baseUrl ?? OFFICIAL_SITE_URLS[Website.JAVBUS]}/${encodeURIComponent(javbusNumber(number))}`;
  }

  protected override async fetch(url: string, context: Context): Promise<string> {
    try {
      return await super.fetch(url, context);
    } catch (error) {
      if (
        failureReasonOf(error) !== "not_found" ||
        context.options.detailUrl ||
        url !== (await this.generateSearchUrl(context))
      ) {
        throw error;
      }
      return super.fetch(new URL(`/search/${encodeURIComponent(javbusNumber(context.number))}`, url).href, context);
    }
  }

  protected async parseSearchPage(
    context: Context,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    const blocked = javbusBlockedPageError($.html());
    if (blocked) {
      throw blocked;
    }

    if ($("h3").length > 0) {
      return this.reuseSearchDocument(searchUrl);
    }
    const candidates = $("a.movie-box")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => typeof href === "string" && href.length > 0);

    const href = candidates.find((candidate) =>
      movieNumbersMatch(new URL(candidate, searchUrl).pathname.split("/").filter(Boolean).at(-1) ?? "", context.number),
    );
    return href ? new URL(href, searchUrl).href : null;
  }

  protected async parseDetailPage(_context: Context, $: CheerioAPI, detailUrl: string): Promise<CrawlerData | null> {
    const titleRaw = extractText($, "h3");
    if (!titleRaw) {
      return null;
    }

    const number = extractParentTextByLabelSelector($, "span.header", ["識別碼", "识别码", "ID"]) ?? "";
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

  protected override classifyDetailFailure(_context: Context, detailHtml: string): SiteError | null {
    return javbusBlockedPageError(detailHtml);
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.JAVBUS,
  crawler: JavbusCrawler,
};
