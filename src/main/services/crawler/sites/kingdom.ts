import { normalizeCode, normalizeText } from "@main/utils/normalization";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { extractText, parseDate } from "../base/parser";
import type { Context } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { toAbsoluteUrl } from "./helpers";

const KINGDOM_BASE_URL = "https://kingdom.vc";

type CheerioInput = Parameters<CheerioAPI>[0];

const extractDlValue = ($: CheerioAPI, label: string): string | undefined => {
  const dt = $("dl dt")
    .filter((_i: number, el: CheerioInput) => $(el).text().trim() === label)
    .first();
  if (dt.length === 0) {
    return undefined;
  }
  const value = dt.next("dd").text().trim();
  return value || undefined;
};

const extractTableValue = ($: CheerioAPI, label: string): string | undefined => {
  const row = $(".table-product .tr")
    .filter((_i: number, el: CheerioInput) => $(el).find(".th").first().text().trim() === label)
    .first();
  if (row.length === 0) {
    return undefined;
  }

  const value = row.find(".td").first().text().trim();
  return value || undefined;
};

const extractDetailValue = ($: CheerioAPI, label: string): string | undefined => {
  return extractTableValue($, label) ?? extractDlValue($, label);
};

const extractDetailLinks = ($: CheerioAPI, label: string): string[] => {
  const row = $(".table-product .tr")
    .filter((_i: number, el: CheerioInput) => $(el).find(".th").first().text().trim() === label)
    .first();
  if (row.length > 0) {
    return row
      .find(".td a")
      .map((_i: number, el: CheerioInput) => $(el).text().trim())
      .get()
      .filter((value: string) => value.length > 0);
  }

  const dt = $("dl dt")
    .filter((_i: number, el: CheerioInput) => $(el).text().trim() === label)
    .first();
  if (dt.length === 0) {
    return [];
  }

  return dt
    .next("dd")
    .find("a")
    .map((_i: number, el: CheerioInput) => $(el).text().trim())
    .get()
    .filter((value: string) => value.length > 0);
};

const extractLabelFromCategories = ($: CheerioAPI): string | undefined => {
  const categories = extractDetailLinks($, "関連カテゴリ");
  const labelCandidates = ["Empress", "Queen", "Princess", "Kingdom", "Bambini", "bambini"];
  const matched = categories.find((value: string) => labelCandidates.includes(value));
  if (!matched) {
    return undefined;
  }
  return matched === "bambini" ? "Bambini" : matched;
};

const findSearchDetailUrlByProductCode = ($: CheerioAPI, baseUrl: string, expectedNumber: string): string | null => {
  const normalizedExpected = normalizeCode(expectedNumber);
  if (!normalizedExpected) {
    return null;
  }

  const html = $.html();
  const matches = html.matchAll(/"(\d+)":\s*\{[\s\S]*?"product_code":"([^"]+)"/gu);
  for (const match of matches) {
    const productId = match[1];
    const productCode = match[2];
    if (normalizeCode(productCode) === normalizedExpected) {
      return toAbsoluteUrl(baseUrl, `/products/detail/${productId}`) ?? null;
    }
  }

  return null;
};

const parseActressFromTitle = (title: string): { cleanTitle: string; actress: string | undefined } => {
  const slashIndex = title.lastIndexOf("/");
  if (slashIndex === -1) {
    return { cleanTitle: title.trim(), actress: undefined };
  }
  return {
    cleanTitle: title.substring(0, slashIndex).trim(),
    actress: title.substring(slashIndex + 1).trim() || undefined,
  };
};

export class KingdomCrawler extends BaseCrawler {
  site(): Website {
    return Website.KINGDOM;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = normalizeText(context.number);
    if (!number) {
      return null;
    }

    const base = this.resolveBaseUrl(context, KINGDOM_BASE_URL);
    return `${base}/products/list?category_id=&name=${encodeURIComponent(number)}`;
  }

  protected async parseSearchPage(context: Context, $: CheerioAPI, _searchUrl: string): Promise<string | null> {
    const base = this.resolveBaseUrl(context, KINGDOM_BASE_URL);

    const exactDetailUrl = findSearchDetailUrlByProductCode($, base, context.number);
    if (exactDetailUrl) {
      return exactDetailUrl;
    }

    const links = $(
      ".ec-shelfGrid__item a[href*='/products/detail/'], .ec-product-item__image a, h2.ec-product-item__title a",
    )
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter(
        (href: string | undefined): href is string => typeof href === "string" && href.includes("/products/detail/"),
      );

    if (links.length === 0) {
      return null;
    }

    return toAbsoluteUrl(base, links[0]) ?? null;
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    const base = this.resolveBaseUrl(context, KINGDOM_BASE_URL);

    const titleRaw = extractText($, "h2.detail-title") ?? extractText($, "h1");
    if (!titleRaw) {
      return null;
    }

    const { cleanTitle, actress } = parseActressFromTitle(titleRaw);

    const number = extractDetailValue($, "商品番号") ?? context.number;
    const releaseDateStr = extractDetailValue($, "発売日");
    const release = releaseDateStr ? (parseDate(releaseDateStr.replace(/\//gu, "-")) ?? undefined) : undefined;

    const actorsFromField = extractDetailLinks($, "女優名");
    const actors: string[] = actorsFromField.length > 0 ? actorsFromField : actress ? [actress] : [];

    const breadcrumbs = $("ol li a")
      .map((_i: number, el: CheerioInput) => $(el).text().trim())
      .get()
      .filter((text: string) => text.length > 0);
    const labelCandidates = ["Empress", "Queen", "Princess", "Kingdom", "Bambini"];
    const label = extractLabelFromCategories($) ?? breadcrumbs.find((b: string) => labelCandidates.includes(b));

    const images = $(".item_visual img")
      .toArray()
      .map((el: CheerioInput) => toAbsoluteUrl(base, $(el).attr("src")))
      .filter((url): url is string => Boolean(url));

    const posterUrl = images[0];
    const thumbUrl = images[1] ?? images[0];
    const sceneImages = images.slice(images.length > 1 ? 2 : 1);
    const plot = extractText($, ".detail-profile__meta__desc");

    return {
      title: cleanTitle,
      number,
      actors,
      genres: [],
      studio: "Kingdom",
      director: undefined,
      publisher: label,
      series: undefined,
      plot,
      release_date: release,
      rating: undefined,
      thumb_url: thumbUrl,
      poster_url: posterUrl,
      fanart_url: undefined,
      scene_images: sceneImages,
      trailer_url: undefined,
      website: Website.KINGDOM,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.KINGDOM,
  crawler: KingdomCrawler,
};
