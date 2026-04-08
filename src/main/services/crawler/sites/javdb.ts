import type { SiteRequestConfig } from "@main/services/network";
import { normalizeCode, normalizeText } from "@main/utils/normalization";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { extractAttr, extractText, parseDate } from "../base/parser";
import type { Context } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { extractParentLinksByLabelSelector, extractParentTextByLabelSelector, toAbsoluteUrl } from "./helpers";

const JAVDB_BASE_URL = "https://javdb.com";
const JAVDB_SITE_REQUEST_CONFIGS: readonly SiteRequestConfig[] = [
  {
    id: "crawler:javdb",
    matches: (url) => url.hostname === "javdb.com" || url.hostname === "www.javdb.com",
    headers: {
      referer: `${JAVDB_BASE_URL}/`,
    },
  },
];

type CheerioInput = Parameters<CheerioAPI>[0];

const findActorLinksBySymbol = ($: CheerioAPI, symbolClass: "female" | "male"): string[] => {
  const selectors = [`strong.${symbolClass}`, `strong.symbol.${symbolClass}`];
  const links = selectors.flatMap((selector) =>
    $(selector)
      .toArray()
      .map((element: CheerioInput) => $(element).prevAll("a").first().text().trim())
      .filter((name: string) => name.length > 0),
  );

  return Array.from(new Set(links));
};

type JavdbSearchResult = {
  href: string;
  title: string;
  meta: string;
};

const pickJavdbSearchResultUrl = (
  baseUrl: string,
  results: JavdbSearchResult[],
  expectedNumber: string,
): string | null => {
  const expectedTitle = expectedNumber.toUpperCase();
  const exact = results.find((item) => item.title.toUpperCase().includes(expectedTitle));
  if (exact) {
    return toAbsoluteUrl(baseUrl, exact.href) ?? null;
  }

  const normalizedExpected = normalizeCode(expectedNumber);
  const fuzzy = results.find((item) => normalizeCode(item.title + item.meta).includes(normalizedExpected));
  return fuzzy ? (toAbsoluteUrl(baseUrl, fuzzy.href) ?? null) : null;
};

export class JavdbCrawler extends BaseCrawler {
  static readonly siteRequestConfigs = JAVDB_SITE_REQUEST_CONFIGS;

  site(): Website {
    return Website.JAVDB;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const raw = normalizeText(context.number);
    if (!raw) {
      return null;
    }

    let number = raw;
    const oldDate = number.match(/\D+(\d{2}\.\d{2}\.\d{2})$/u);
    if (oldDate) {
      number = number.replace(oldDate[1], `20${oldDate[1]}`);
    }

    const base = this.resolveBaseUrl(context, JAVDB_BASE_URL);
    return `${base}/search?q=${encodeURIComponent(number)}&locale=zh`;
  }

  protected async parseSearchPage(context: Context, $: CheerioAPI, searchUrl: string): Promise<string | null> {
    const pageText = $.root().text();
    if (pageText.includes("ray-id")) {
      throw new Error("JavDB blocked by Cloudflare challenge");
    }

    if (pageText.includes("banned your access")) {
      throw new Error("JavDB temporarily banned current IP");
    }

    if (pageText.includes("Due to copyright restrictions")) {
      throw new Error("JavDB blocked due to region restriction");
    }

    const results = $("a.box")
      .toArray()
      .map((element: CheerioInput) => {
        const href = $(element).attr("href") ?? "";
        const title = $(element).find("div.video-title strong").text().trim();
        const meta = $(element).find("div.meta").text().trim();
        return { href, title, meta };
      })
      .filter((item) => item.href.length > 0);

    if (results.length === 0) {
      this.logger.debug(`No javdb search results for ${context.number} via ${searchUrl}`);
      return null;
    }

    const base = this.resolveBaseUrl(context, JAVDB_BASE_URL);
    return pickJavdbSearchResultUrl(base, results, context.number);
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    const title = extractText($, "h2.title.is-4 strong.current-title");
    if (!title) {
      return null;
    }

    const number =
      extractAttr($, "a.button.is-white.copy-to-clipboard", "data-clipboard-text")?.trim() || context.number;

    const actorsPrimary = findActorLinksBySymbol($, "female");
    const actorsFallback = findActorLinksBySymbol($, "male");
    const actorsUnmarked = extractParentLinksByLabelSelector($, "strong", ["演員:", "Actors:", "演员:"]);
    const actors =
      actorsPrimary.length > 0 ? actorsPrimary : actorsFallback.length > 0 ? actorsFallback : actorsUnmarked;

    const genres = extractParentLinksByLabelSelector($, "strong", ["類別:", "Tags:", "类别:"]);

    const studio = extractParentTextByLabelSelector($, "strong", ["片商:", "Maker:"]);
    const publisher = extractParentTextByLabelSelector($, "strong", ["發行:", "Publisher:"]);
    const series = extractParentTextByLabelSelector($, "strong", ["系列:", "Series:"]);
    const director = extractParentTextByLabelSelector($, "strong", ["導演:", "Director:"]);
    const release = parseDate(extractParentTextByLabelSelector($, "strong", ["日期:", "Released Date:"])) ?? undefined;

    const thumbUrl = extractAttr($, "img.video-cover", "src");
    const thumbUrlAbsolute = toAbsoluteUrl(JAVDB_BASE_URL, thumbUrl);
    const posterUrl = thumbUrlAbsolute?.replace("/covers/", "/thumbs/");

    const trailerUrl = extractAttr($, "video#preview-video source", "src") ?? undefined;
    const trailerUrlAbsolute = toAbsoluteUrl(JAVDB_BASE_URL, trailerUrl);

    const sceneImageUrls = $("div.tile-images.preview-images a.tile-item")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => typeof href === "string" && href.length > 0)
      .map((href: string) => toAbsoluteUrl(JAVDB_BASE_URL, href))
      .filter((href): href is string => Boolean(href));

    const ratingText = extractParentTextByLabelSelector($, "strong", ["評分:", "Rating:"]);
    let ratingValue: number | undefined;
    if (ratingText) {
      const match = ratingText.match(/([\d.]+)/u);
      if (match) {
        const parsed = Number.parseFloat(match[1]);
        if (Number.isFinite(parsed)) {
          ratingValue = parsed;
        }
      }
    }

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
      rating: ratingValue,
      thumb_url: thumbUrlAbsolute,
      poster_url: posterUrl,
      fanart_url: undefined,
      scene_images: sceneImageUrls,
      trailer_url: trailerUrlAbsolute,
      website: Website.JAVDB,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.JAVDB,
  crawler: JavdbCrawler,
};
