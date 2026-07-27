import { normalizeText, uniqueStrings } from "@mdcz/runtime/shared";
import type { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../base/BaseCrawler";
import type { Context, CrawlerInput, SearchPageResolution } from "../base/types";
import { toAbsoluteUrl } from "./helpers";
import { type JsonLdRecord, readFirstJsonLdRecord } from "./jsonLd";

interface H0930FamilyContext extends Context {
  movieId: string;
  canonicalNumber: string;
}

export interface H0930FamilySite {
  site: Website;
  baseUrl: string;
  numberPrefix: string;
  provider: string;
  publicHosts: readonly string[];
}

const MOVIE_ID_PATTERN = /^[a-z]+\d+$/iu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const normalized = normalizeText(String(value));
  return normalized || undefined;
};

const readRecordString = (record: Record<string, unknown> | null | undefined, key: string): string | undefined =>
  record ? toStringValue(record[key]) : undefined;

const readFirstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const normalized = toStringValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
};

const parseIsoDate = (value: string | undefined): string | undefined => value?.match(/^(\d{4}-\d{2}-\d{2})/u)?.[1];

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

const toJsonLdActors = (value: unknown): string[] => {
  if (typeof value === "string") {
    return uniqueStrings([value]);
  }

  if (Array.isArray(value)) {
    return uniqueStrings(
      value.map((entry) =>
        typeof entry === "string" ? entry : isRecord(entry) ? toStringValue(entry.name) : undefined,
      ),
    );
  }

  return isRecord(value) ? uniqueStrings([toStringValue(value.name)]) : [];
};

const toJsonLdImage = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  return Array.isArray(value)
    ? value.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;
};

const readNestedRecord = (record: JsonLdRecord | null, key: string): Record<string, unknown> | null => {
  const value = record?.[key];
  return isRecord(value) ? value : null;
};

const readReleasedDate = (record: JsonLdRecord | null): string | undefined => {
  const releasedEvent = readNestedRecord(record, "releasedEvent");
  const video = readNestedRecord(record, "video");
  return parseIsoDate(
    readFirstString(record?.dateCreated, releasedEvent?.startDate, video?.uploadDate, video?.dateCreated),
  );
};

const decodeFamilyHtml = (bytes: Uint8Array): string => {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!/charset\s*=\s*euc-jp/iu.test(utf8)) {
    return utf8;
  }

  try {
    return new TextDecoder("euc-jp").decode(bytes);
  } catch {
    return utf8;
  }
};

const extractMetaContent = ($: CheerioAPI, selector: string): string | undefined =>
  normalizeText($(selector).first().attr("content")) || undefined;

const extractDocumentTitle = ($: CheerioAPI): string | undefined => {
  const title =
    normalizeText($(".moviePlay_title h1").first().text()) ||
    extractMetaContent($, "meta[property='og:title']") ||
    normalizeText($("title").first().text());

  return title?.replace(/\s+/gu, " ").trim();
};

export abstract class BaseH0930FamilyCrawler extends BaseCrawler {
  protected abstract readonly family: H0930FamilySite;

  site(): Website {
    return this.family.site;
  }

  protected override newContext(input: CrawlerInput): H0930FamilyContext {
    const context = super.newContext(input) as H0930FamilyContext;
    const movieId =
      this.normalizeMovieId(input.options?.detailUrl ?? "") ??
      this.normalizeMovieId(input.number) ??
      input.number.toLowerCase();
    context.movieId = movieId;
    context.canonicalNumber = `${this.family.numberPrefix}-${movieId.toUpperCase()}`;
    return context;
  }

  protected async generateSearchUrl(context: H0930FamilyContext): Promise<string | null> {
    return new URL(`/moviepages/${context.movieId}/index.html`, this.family.baseUrl).href;
  }

  protected override async fetch(url: string, context: H0930FamilyContext): Promise<string> {
    const bytes = await this.gateway.fetchContent(url, this.createFetchOptions(context));
    return decodeFamilyHtml(bytes);
  }

  protected async parseSearchPage(
    _context: H0930FamilyContext,
    _$: CheerioAPI,
    searchUrl: string,
  ): Promise<SearchPageResolution> {
    return this.reuseSearchDocument(searchUrl);
  }

  protected classifyDetailFailure(
    context: H0930FamilyContext,
    _detailHtml: string,
    _$: CheerioAPI,
    _detailUrl: string,
  ): string | null {
    return `Detail URL not found for ${context.canonicalNumber}`;
  }

  protected async parseDetailPage(
    context: H0930FamilyContext,
    $: CheerioAPI,
    detailUrl: string,
  ): Promise<CrawlerData | null> {
    const jsonLd = readFirstJsonLdRecord($);
    const video = readNestedRecord(jsonLd, "video");
    const title = readFirstString(jsonLd?.name, video?.name, extractDocumentTitle($));
    if (!title) {
      return null;
    }

    const coverUrl = toAbsoluteUrl(
      detailUrl,
      readFirstString(
        toJsonLdImage(jsonLd?.image),
        video?.thumbnail,
        video?.thumbnailUrl,
        $("video").first().attr("poster"),
        extractMetaContent($, "meta[property='og:image']"),
      ),
    );
    const trailerUrl = toAbsoluteUrl(
      detailUrl,
      readFirstString(video?.contentUrl, $("video source").first().attr("src"), $("video").first().attr("src")),
    );
    const actors = uniqueStrings([...toJsonLdActors(jsonLd?.actor), ...toJsonLdActors(video?.actor)]);
    const metaKeywords = extractMetaContent($, "meta[name='keywords']")
      ?.split(/[、,，]/u)
      .map((value) => normalizeText(value))
      .filter((value) => value.length > 0);
    const provider = readFirstString(video?.provider, readRecordString(jsonLd, "provider"), this.family.provider);

    return {
      title,
      number: context.canonicalNumber,
      actors,
      genres: uniqueStrings(metaKeywords ?? []),
      studio: provider,
      director: undefined,
      publisher: provider,
      series: undefined,
      plot: readFirstString(jsonLd?.description, video?.description, extractMetaContent($, "meta[name='description']")),
      release_date: readReleasedDate(jsonLd),
      rating: undefined,
      durationSeconds: parseIsoDurationToSeconds(readFirstString(jsonLd?.duration, video?.duration)),
      thumb_url: this.isPublicUrl(coverUrl) ? coverUrl : undefined,
      poster_url: this.isPublicUrl(coverUrl) ? coverUrl : undefined,
      fanart_url: undefined,
      scene_images: this.extractSceneImages($, detailUrl, context.movieId),
      trailer_url: this.isPublicUrl(trailerUrl) ? trailerUrl : undefined,
      website: this.family.site,
    };
  }

  private normalizeMovieId(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const url = new URL(trimmed);
      const matched = url.pathname.match(/^\/moviepages\/([^/]+)\/index\.html$/iu);
      if (this.isPublicUrl(url.href) && matched?.[1] && MOVIE_ID_PATTERN.test(matched[1])) {
        return matched[1].toLowerCase();
      }
      return null;
    } catch {}

    const normalized = trimmed.toLowerCase().replace(/[\s_.]+/gu, "-");
    const prefix = this.family.numberPrefix.toLowerCase();
    const prefixed = normalized.startsWith(`${prefix}-`) ? normalized.slice(prefix.length + 1) : normalized;
    return MOVIE_ID_PATTERN.test(prefixed) ? prefixed.toLowerCase() : null;
  }

  private isPublicUrl(url: string | undefined): url is string {
    if (!url) {
      return false;
    }

    try {
      return this.family.publicHosts.includes(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  private isPublicSceneImageUrl(url: string, movieId: string): boolean {
    return (
      this.isPublicUrl(url) &&
      new RegExp(`/moviepages/${movieId}/images/g_[bs]\\d+\\.(?:jpe?g|png|webp)$`, "iu").test(url)
    );
  }

  private extractSceneImages($: CheerioAPI, detailUrl: string, movieId: string): string[] {
    const quotedUrls = Array.from(
      $.html().matchAll(
        /["']((?:https?:)?\/\/[^"']+\/moviepages\/[^"']+\/images\/g_[bs]\d+\.(?:jpe?g|png|webp))["']/giu,
      ),
    ).map((match) => match[1]);
    const domUrls = $("img[src], a[href]")
      .toArray()
      .flatMap((element) => [$(element).attr("src"), $(element).attr("href")]);

    return uniqueStrings(
      [...quotedUrls, ...domUrls]
        .map((value) => toAbsoluteUrl(detailUrl, value))
        .filter((url): url is string => typeof url === "string" && this.isPublicSceneImageUrl(url, movieId)),
    );
  }
}
