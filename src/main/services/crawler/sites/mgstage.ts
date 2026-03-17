import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../base/BaseCrawler";
import { extractText, parseDate } from "../base/parser";
import type { Context } from "../base/types";
import { extractByLabel, toAbsoluteUrl, uniqueStrings } from "./helpers";

const MGSTAGE_BASE_URL = "https://www.mgstage.com";

type CheerioInput = Parameters<CheerioAPI>[0];

export class MGStageCrawler extends BaseCrawler {
  site(): Website {
    return Website.MGSTAGE;
  }

  protected override buildHeaders(context: Context): Record<string, string> {
    return {
      ...super.buildHeaders(context),
      "accept-language": "ja-JP,ja;q=0.9",
      cookie: "adc=1",
    };
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = context.number.trim();
    if (!number) {
      return null;
    }

    return `${MGSTAGE_BASE_URL}/search/cSearch.php?search_word=${encodeURIComponent(number)}`;
  }

  protected async parseSearchPage(context: Context, $: CheerioAPI, _searchUrl: string): Promise<string | null> {
    const expected = context.number.toUpperCase().replace(/-/gu, "");

    const candidates = $("a[href*='/product/product_detail/']")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => Boolean(href));

    for (const href of candidates) {
      const normalized = href.toUpperCase().replace(/-/gu, "");
      if (normalized.includes(expected)) {
        return toAbsoluteUrl(MGSTAGE_BASE_URL, href) ?? null;
      }
    }

    return candidates[0] ? (toAbsoluteUrl(MGSTAGE_BASE_URL, candidates[0]) ?? null) : null;
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    const titleRaw = extractText($, "h1.tag") ?? extractText($, "title");
    if (!titleRaw) {
      return null;
    }

    const title = titleRaw.replace(/\s*-\s*MGS動画\s*$/u, "").trim();
    if (!title) {
      return null;
    }

    const number = extractByLabel($, "品番") ?? context.number;
    const releaseDate = parseDate(extractByLabel($, "配信開始日") ?? extractByLabel($, "発売日")) ?? undefined;
    const studio = extractByLabel($, "メーカー");
    const publisher = extractByLabel($, "レーベル") ?? studio;
    const series = extractByLabel($, "シリーズ");

    const actors = uniqueStrings(
      $("a[href*='/search/cSearch.php?tag_id=']")
        .toArray()
        .map((element: CheerioInput) => $(element).text().trim())
        .filter((name: string) => name.length > 0),
    );

    const genres = uniqueStrings(
      $("a[href*='/search/cSearch.php?genre=']")
        .toArray()
        .map((element: CheerioInput) => $(element).text().trim())
        .filter((name: string) => name.length > 0),
    );

    const plot = $("p.txt.introduction").text().trim() || undefined;

    const thumbUrl = $("a.enlarge_image").first().attr("href") ?? $("img.enlarge_image").first().attr("src");
    const thumbUrlAbsolute = thumbUrl ? toAbsoluteUrl(MGSTAGE_BASE_URL, thumbUrl) : undefined;

    const sampleImages = $("a.sample_image")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => Boolean(href))
      .map((href: string) => toAbsoluteUrl(MGSTAGE_BASE_URL, href))
      .filter((url): url is string => Boolean(url));

    const ratingText = extractText($, "span.review_average");
    const ratingValue = ratingText ? Number.parseFloat(ratingText) : undefined;
    const rating = Number.isFinite(ratingValue) ? (ratingValue as number) * 2 : undefined;

    return {
      title,
      number,
      actors,
      genres,
      studio,
      director: undefined,
      publisher,
      series,
      plot,
      release_date: releaseDate,
      rating,
      thumb_url: thumbUrlAbsolute,
      poster_url: undefined,
      fanart_url: undefined,
      sample_images: sampleImages,
      trailer_url: undefined,
      website: Website.MGSTAGE,
    };
  }
}
