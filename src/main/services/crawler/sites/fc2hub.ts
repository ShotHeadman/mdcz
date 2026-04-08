import { normalizeCode, normalizeText } from "@main/utils/normalization";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { type CheerioAPI, load } from "cheerio";

import { extractAttr, parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { BaseFc2Crawler } from "./BaseFc2Crawler";
import { pickSearchResultDetailUrl, toAbsoluteUrl, uniqueStrings } from "./helpers";

const BASE_URL = "https://javten.com";

type JsonLdRecord = Record<string, unknown>;

type Fc2HubMovieJsonLd = JsonLdRecord & {
  name?: string;
  description?: string;
  image?: string | string[];
  identifier?: string | string[];
  datePublished?: string;
  duration?: string;
  actor?: Array<string | { name?: string }>;
  genre?: string | string[];
  director?: string | { name?: string };
  aggregateRating?: {
    ratingValue?: number | string;
  };
};

const isRecord = (value: unknown): value is JsonLdRecord => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const unpackJsonLdRecord = (value: unknown): JsonLdRecord[] => {
  if (!isRecord(value)) {
    return [];
  }

  const graph = value["@graph"];
  if (!Array.isArray(graph)) {
    return [value];
  }

  return graph.filter((entry): entry is JsonLdRecord => isRecord(entry));
};

const hasJsonLdType = (record: JsonLdRecord, type: string): boolean => {
  const rawType = record["@type"];
  if (typeof rawType === "string") {
    return rawType === type;
  }

  return Array.isArray(rawType) && rawType.includes(type);
};

const readMovieJsonLd = ($: CheerioAPI): Fc2HubMovieJsonLd | null => {
  const scripts = $("script[type='application/ld+json']").toArray();

  for (const script of scripts) {
    const text = $(script).text().trim();
    if (!text) {
      continue;
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      const records = Array.isArray(parsed) ? parsed : [parsed];

      for (const record of records.flatMap(unpackJsonLdRecord)) {
        if (hasJsonLdType(record, "Movie")) {
          return record as Fc2HubMovieJsonLd;
        }
      }
    } catch {}
  }

  return null;
};

const toHttpsUrl = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return value.replace(/^http:\/\//iu, "https://");
};

const toStringArray = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
};

const toJsonLdActorNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value.map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      return isRecord(entry) && typeof entry.name === "string" ? entry.name : undefined;
    }),
  );
};

const toRating = (value: unknown): number | undefined => {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
};

const parseIsoDurationToSeconds = (value: unknown): number | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const matched = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/iu);
  if (!matched) {
    return undefined;
  }

  const hours = Number.parseInt(matched[1] ?? "0", 10);
  const minutes = Number.parseInt(matched[2] ?? "0", 10);
  const seconds = Number.parseInt(matched[3] ?? "0", 10);
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : undefined;
};

const readDescriptionText = ($: CheerioAPI): string | undefined => {
  const html = $("div.col.des").first().html();
  if (!html) {
    return undefined;
  }

  const fragment = load(
    `<div>${html
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<\/(?:p|div|body)>/giu, "\n")
      .replace(/&nbsp;/giu, " ")}</div>`,
  );
  fragment("script, style, noscript").remove();

  const text = fragment
    .root()
    .text()
    .replace(/\r/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return text || undefined;
};

const extractDescriptionText = ($: CheerioAPI): string | undefined => {
  const rawText = readDescriptionText($);
  if (!rawText) {
    return undefined;
  }
  let text = rawText.replace(/\b[A-Za-z0-9+/=]{24,}\b/gu, " ").trim();

  const markerIndexes = ["■商品内容", "■出演", "評価"]
    .map((marker) => text.indexOf(marker))
    .filter((index) => index > 0);
  if (markerIndexes.length > 0) {
    text = text.slice(0, Math.min(...markerIndexes)).trim();
  }

  text = text
    .replace(/※この商品は[\s\S]*$/u, "")
    .replace(/※この商品の無断転載[\s\S]*$/u, "")
    .trim();

  return text || undefined;
};

const extractActorsFromDescription = ($: CheerioAPI): string[] => {
  const text = readDescriptionText($);
  if (!text) {
    return [];
  }

  const performerBlock = text.match(/■出演([\s\S]*?)(?:\n■|\n評価|$)/u)?.[1];
  if (!performerBlock) {
    return [];
  }

  const names = Array.from(performerBlock.matchAll(/(?:^|\n)\s*名前[：:\s　]*([^\n]+)/gu))
    .map((match) => normalizeText(match[1]))
    .filter((value) => value.length > 0);

  return uniqueStrings(names);
};

const extractSellerName = ($: CheerioAPI): string | undefined => {
  const sellerCard = $("div.card-header")
    .toArray()
    .map((element) => $(element))
    .find((element) => normalizeText(element.text()).includes("売り手情報"))
    ?.closest("div.card");

  const seller = sellerCard?.find("div.col-8").first().text();
  const normalized = normalizeText(seller);
  return normalized || undefined;
};

const extractSceneImageUrls = ($: CheerioAPI, baseUrl: string): string[] => {
  return uniqueStrings(
    $("a[data-fancybox='gallery']")
      .toArray()
      .map((element) => toHttpsUrl(toAbsoluteUrl(baseUrl, $(element).attr("href"))))
      .filter((value): value is string => Boolean(value)),
  );
};

const extractDetailUrlFromMeta = ($: CheerioAPI, expectedNumber: string): string | undefined => {
  const candidates = [
    extractAttr($, "link[rel='canonical']", "href"),
    extractAttr($, "meta[property='og:url']", "content"),
  ];

  return candidates
    .map((value) => toHttpsUrl(value))
    .find(
      (value) =>
        typeof value === "string" && value.includes("/video/") && normalizeCode(value).includes(expectedNumber),
    );
};

export class Fc2HubCrawler extends BaseFc2Crawler {
  site(): Website {
    return Website.FC2HUB;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const base = this.resolveBaseUrl(context, BASE_URL);
    return `${base}/search?kw=${encodeURIComponent(context.number)}`;
  }

  protected async parseSearchPage(
    context: Context,
    $: CheerioAPI,
    _searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    const pageText = $.root().text();
    if (pageText.includes("Access denied") && pageText.includes("Cloudflare")) {
      throw new Error("FC2HUB blocked by Cloudflare challenge");
    }

    const base = this.resolveBaseUrl(context, BASE_URL);
    const metaUrl = extractDetailUrlFromMeta($, context.number);
    if (metaUrl) {
      return this.reuseSearchDocument(metaUrl);
    }

    const candidates = $("a[href*='/video/']")
      .toArray()
      .map((element) => $(element).attr("href"));

    return pickSearchResultDetailUrl(base, candidates, context.number);
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    const movie = readMovieJsonLd($);
    const title = normalizeText($("h1.card-text.fc2-title").first().text()) || normalizeText(movie?.name);
    if (!title) {
      return null;
    }

    const base = this.resolveBaseUrl(context, BASE_URL);
    const jsonLdImage = toStringArray(movie?.image)[0];
    const coverUrl =
      toHttpsUrl(jsonLdImage) ??
      toHttpsUrl(extractAttr($, "meta[property='og:image']", "content")) ??
      toHttpsUrl(extractAttr($, "meta[name='twitter:image']", "content"));

    const actors = uniqueStrings([...toJsonLdActorNames(movie?.actor), ...extractActorsFromDescription($)]);
    const genres = uniqueStrings([
      ...$("p.card-text a.badge")
        .toArray()
        .map((element) => $(element).text()),
      ...toStringArray(movie?.genre),
    ]);
    const directorName = normalizeText(
      typeof movie?.director === "string"
        ? movie.director
        : isRecord(movie?.director) && typeof movie.director.name === "string"
          ? movie.director.name
          : "",
    );
    const studio = extractSellerName($) ?? (directorName || undefined);

    const jsonLdPlot = normalizeText(movie?.description);
    const plot = extractDescriptionText($) ?? (jsonLdPlot || undefined);

    return this.buildFc2Data(context, {
      title,
      actors,
      studio,
      genres,
      thumbUrl: coverUrl,
      posterUrl: coverUrl,
      plot,
      releaseDate: parseDate(movie?.datePublished) ?? undefined,
      durationSeconds: parseIsoDurationToSeconds(movie?.duration),
      rating: toRating(movie?.aggregateRating?.ratingValue),
      sceneImageUrls: extractSceneImageUrls($, base),
    });
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.FC2HUB,
  crawler: Fc2HubCrawler,
};
