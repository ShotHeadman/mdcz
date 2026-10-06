import { SiteError } from "@mdcz/runtime/network";
import { normalizeText, uniqueStrings } from "@mdcz/runtime/shared";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";

import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { BaseFc2Crawler } from "./BaseFc2Crawler";
import { pageIdentityUrl, parseClockDurationToSeconds, toAbsoluteUrl } from "./helpers";

const FC2_NOT_FOUND_MARKERS = [
  "お探しの商品が見つかりません",
  "We couldn't find any products that match your search",
] as const;

const BASE_URL = "https://adult.contents.fc2.com";

const extractSellerName = ($: CheerioAPI): string | undefined => {
  const sellerFromProfileLink = $("div[data-section='userInfo']")
    .first()
    .find("a[href*='/users/']")
    .toArray()
    .map((element) => normalizeText($(element).text()))
    .find((value) => Boolean(value));

  if (sellerFromProfileLink) {
    return sellerFromProfileLink;
  }

  const legacySeller = normalizeText($("div.col-8").first().text());
  return legacySeller || undefined;
};

const extractGenres = ($: CheerioAPI): string[] => {
  return uniqueStrings([
    ...$("p.card-text a[href*='/tag/']")
      .toArray()
      .map((element) => $(element).text().trim()),
    ...$("section.items_article_TagArea a[data-tag], section.items_article_TagArea a[href*='tag=']")
      .toArray()
      .map((element) => $(element).attr("data-tag") ?? $(element).text().trim()),
  ]).filter((value) => value !== "無修正");
};

const extractReleaseDate = ($: CheerioAPI): string | undefined => {
  const legacyDate = parseDate($("div.items_article_Releasedate p").first().text());
  if (legacyDate) {
    return legacyDate;
  }

  // The sale date label follows the page language (販売日, Sale Day), so match its YYYY/MM/DD value instead.
  const salesDateText = $("div.items_article_softDevice p")
    .toArray()
    .map((element) => normalizeText($(element).text()))
    .find((value) => /\d{4}\/\d{1,2}\/\d{1,2}/u.test(value));

  return parseDate(salesDateText);
};

const isFc2NotFoundPage = ($: CheerioAPI): boolean => {
  const titleText = normalizeText($("title").first().text());
  const pageText = normalizeText($.root().text());
  return FC2_NOT_FOUND_MARKERS.some((marker) => titleText.includes(marker) || pageText.includes(marker));
};

export class Fc2Crawler extends BaseFc2Crawler {
  site(): Website {
    return Website.FC2;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    return `${BASE_URL}/article/${context.number}/`;
  }

  protected async parseSearchPage(
    _context: Context,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    if (isFc2NotFoundPage($)) {
      return null;
    }

    return this.reuseSearchDocument(searchUrl);
  }

  protected async parseDetailPage(_context: Context, $: CheerioAPI): Promise<CrawlerData | null> {
    // FC2 hides a scraper watermark inside the title with an inline-styled element; seller titles are plain text.
    const heading = $("div[data-section='userInfo'] h3").first();
    heading.find("[style]").remove();
    const title = heading.text().trim();
    if (!title) {
      return null;
    }

    const thumb = $("ul.items_article_SampleImagesArea li a").first().attr("href");
    const thumbUrl = toAbsoluteUrl(BASE_URL, thumb);
    const posterUrl = toAbsoluteUrl(BASE_URL, $("div.items_article_MainitemThumb img").first().attr("src"));
    const genres = extractGenres($);

    const studio = extractSellerName($);

    const number =
      $(".items_article_softDevice")
        .text()
        .match(/FC2[\s-]*(?:PPV[\s-]*)?(\d+)/iu)?.[1] ??
      pageIdentityUrl($).match(/\/article\/(\d+)\//u)?.[1] ??
      "";
    return this.buildFc2Data({
      number,
      title,
      studio,
      genres,
      thumbUrl,
      posterUrl,
      plot: $("meta[name='description']").attr("content")?.trim(),
      releaseDate: extractReleaseDate($),
      durationSeconds: parseClockDurationToSeconds(
        $("div.items_article_MainitemThumb p.items_article_info").first().text(),
      ),
      sceneImageUrls: $("ul.items_article_SampleImagesArea li a")
        .toArray()
        .map((element) => toAbsoluteUrl(BASE_URL, $(element).attr("href")))
        .filter((value): value is string => Boolean(value)),
    });
  }

  protected override classifyDetailFailure(_context: Context, _detailHtml: string, $: CheerioAPI): SiteError | null {
    if (isFc2NotFoundPage($)) {
      return new SiteError("not_found", "Product not found on FC2 official site");
    }

    return null;
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.FC2,
  crawler: Fc2Crawler,
};
