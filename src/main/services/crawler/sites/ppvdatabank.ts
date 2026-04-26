import { normalizeText } from "@main/utils/normalization";
import { uniqueStrings } from "@main/utils/strings";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { BaseFc2Crawler } from "./BaseFc2Crawler";
import { parseClockDurationToSeconds, toAbsoluteUrl } from "./helpers";

const BASE_URL = "https://ppvdatabank.com";
const NOT_FOUND_MARKERS = ["404 File Not Found", "お探しのページは見つかりませんでした"] as const;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const isNotFoundPage = ($: CheerioAPI): boolean => {
  const titleText = normalizeText($("title").first().text());
  const pageText = normalizeText($.root().text());
  return NOT_FOUND_MARKERS.some((marker) => titleText.includes(marker) || pageText.includes(marker));
};

const findMetaItem = ($: CheerioAPI, label: string) => {
  return $("ul.meta li")
    .toArray()
    .find((element) => {
      const text = normalizeText($(element).text());
      return new RegExp(`^${escapeRegExp(label)}\\s*:`, "u").test(text);
    });
};

const extractMetaText = ($: CheerioAPI, label: string): string | undefined => {
  const item = findMetaItem($, label);
  if (!item) {
    return undefined;
  }

  const text = normalizeText($(item).text());
  return text.replace(new RegExp(`^${escapeRegExp(label)}\\s*:\\s*`, "u"), "").trim() || undefined;
};

const extractSellerName = ($: CheerioAPI): string | undefined => {
  const item = findMetaItem($, "販売者");
  if (!item) {
    return undefined;
  }

  const sellerFromLink = normalizeText($(item).find("a").first().text());
  if (sellerFromLink) {
    return sellerFromLink;
  }

  return extractMetaText($, "販売者");
};

const extractTitle = ($: CheerioAPI): string | undefined => {
  const candidates = [
    normalizeText($("div.article_title a").first().text()),
    normalizeText($("meta[name='title']").attr("content") ?? ""),
    normalizeText($("title").first().text()),
  ];

  return candidates.find((value) => value.length > 0);
};

export class PpvDatabankCrawler extends BaseFc2Crawler {
  site(): Website {
    return Website.PPVDATABANK;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    return `${BASE_URL}/article/${context.number}/`;
  }

  protected async parseSearchPage(
    _context: Context,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    if (isNotFoundPage($)) {
      return null;
    }

    return this.reuseSearchDocument(searchUrl);
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, detailUrl: string): Promise<CrawlerData | null> {
    const title = extractTitle($);
    if (!title) {
      return null;
    }

    const explanation = normalizeText($("div.explanation").first().text());
    const thumbUrl = toAbsoluteUrl(detailUrl, $("div.thumb img").first().attr("src"));
    const sceneImageUrls = uniqueStrings(
      $("ul.sample_image_area a")
        .toArray()
        .map((element) => toAbsoluteUrl(detailUrl, $(element).attr("href"))),
    );

    return this.buildFc2Data(context, {
      title,
      studio: extractSellerName($),
      thumbUrl,
      posterUrl: thumbUrl,
      plot: explanation && explanation !== title ? explanation : undefined,
      releaseDate: parseDate(extractMetaText($, "販売日")),
      durationSeconds: parseClockDurationToSeconds(extractMetaText($, "再生時間")),
      sceneImageUrls,
    });
  }

  protected override classifyDetailFailure(_context: Context, _detailHtml: string, $: CheerioAPI): string | null {
    if (isNotFoundPage($)) {
      return "Product not found on ppvdatabank";
    }

    return null;
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.PPVDATABANK,
  crawler: PpvDatabankCrawler,
};
