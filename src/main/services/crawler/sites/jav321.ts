import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../base/BaseCrawler";
import { extractText, parseDate } from "../base/parser";
import type { Context, CrawlerInput, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";
import { pickSearchResultDetailUrl, toAbsoluteUrl, uniqueStrings } from "./helpers";

const JAV321_BASE_URL = "https://www.jav321.com";

type CheerioInput = Parameters<CheerioAPI>[0];

interface Jav321Context extends Context {
  postBody?: string;
}

const splitActorText = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  const normalized = value
    .replace(/&nbsp;/giu, " ")
    .replace(/[♀♂]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    return [];
  }

  const parts = normalized
    .split(/[、,，/&＆]/u)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (parts.length > 1) {
    return uniqueStrings(parts);
  }

  return [normalized];
};

const extractOnErrorFallbackUrl = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const match = value.match(/this\.src\s*=\s*['"]([^'"]+)['"]/iu);
  return match?.[1];
};

const normalizeJav321Url = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return value.replace(/^(https?:\/\/[^/]+)\/{2,}/iu, "$1/");
};

const JAV321_SCENE_IMAGE_PATTERN = /jp-\d+\.(?:jpe?g|png|webp)$/iu;

const isJav321SnapshotImageUrl = (value: string): boolean => JAV321_SCENE_IMAGE_PATTERN.test(value);

const isJav321SameOriginUrl = (value: string): boolean => value.startsWith(`${JAV321_BASE_URL}/`);

const buildSnapshotImageUrl = (href: string | undefined): string | undefined => {
  if (!href) {
    return undefined;
  }

  const match = href.match(/^\/snapshot\/([^/]+)\/\d+\/(\d+)$/iu);
  if (!match) {
    return undefined;
  }

  const [, contentId, index] = match;
  return `${JAV321_BASE_URL}/digital/video/${contentId}/${contentId}jp-${index}.jpg`;
};

const resolveSnapshotImageUrl = (
  href: string | undefined,
  ...candidates: Array<string | undefined>
): string | undefined => {
  const normalizedCandidates = candidates
    .map((candidate) => normalizeJav321Url(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));

  const directSceneImage = normalizedCandidates.find(
    (candidate) => !isJav321SameOriginUrl(candidate) && isJav321SnapshotImageUrl(candidate),
  );
  if (directSceneImage) {
    return directSceneImage;
  }

  const mirroredSceneImage = normalizedCandidates.find((candidate) => isJav321SnapshotImageUrl(candidate));
  if (mirroredSceneImage) {
    return mirroredSceneImage;
  }

  const sameOriginCandidate = normalizedCandidates.find((candidate) => isJav321SameOriginUrl(candidate));
  if (sameOriginCandidate) {
    return buildSnapshotImageUrl(href) ?? sameOriginCandidate;
  }

  return normalizedCandidates[0] ?? buildSnapshotImageUrl(href);
};

export class Jav321Crawler extends BaseCrawler {
  site(): Website {
    return Website.JAV321;
  }

  protected override newContext(input: CrawlerInput): Jav321Context {
    const context = super.newContext(input) as Jav321Context;
    context.postBody = `sn=${encodeURIComponent(input.number)}`;
    return context;
  }

  protected async generateSearchUrl(_context: Jav321Context): Promise<string | null> {
    return `${JAV321_BASE_URL}/search`;
  }

  protected override async fetch(url: string, context: Jav321Context): Promise<string> {
    if (url === `${JAV321_BASE_URL}/search` && context.postBody) {
      const headers = this.buildHeaders(context);
      headers["content-type"] = "application/x-www-form-urlencoded";
      return this.gateway.fetchPostHtml(url, context.postBody, {
        timeout: context.options.timeoutMs,
        signal: context.options.signal,
        headers,
      });
    }

    return super.fetch(url, context);
  }

  protected async parseSearchPage(
    context: Jav321Context,
    $: CheerioAPI,
    _searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    // JAV321 search redirects to detail page or shows results
    // Check if we're already on a detail page
    const panelHeading = $("div.panel-heading h3").first().text().trim();
    if (panelHeading) {
      return this.reuseSearchDocument(_searchUrl);
    }

    const candidates = $("a[href*='/video/']")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => Boolean(href));

    return pickSearchResultDetailUrl(JAV321_BASE_URL, candidates, context.number);
  }

  protected async parseDetailPage(
    context: Jav321Context,
    $: CheerioAPI,
    _detailUrl: string,
  ): Promise<CrawlerData | null> {
    const titleRaw = extractText($, "div.panel-heading h3");
    if (!titleRaw) {
      return null;
    }

    const title = titleRaw.trim();
    if (!title) {
      return null;
    }

    // Extract metadata from info block
    const infoHtml = $("div.col-md-9").first().html() ?? "";

    const extractField = (label: string): string | undefined => {
      const regex = new RegExp(`<b>${label}</b>\\s*:?\\s*(.+?)(?:<br|<\\/div|$)`, "iu");
      const match = infoHtml.match(regex);
      if (!match?.[1]) {
        return undefined;
      }
      // Strip HTML tags and trim
      const value = match[1].replace(/<[^>]*>/gu, "").trim();
      return value.length > 0 ? value : undefined;
    };

    const extractFieldLinks = (label: string): string[] => {
      const regex = new RegExp(`<b>${label}</b>\\s*:?\\s*(.+?)(?:<br|<\\/div|$)`, "iu");
      const match = infoHtml.match(regex);
      if (!match?.[1]) {
        return [];
      }
      const linkMatches = match[1].matchAll(/<a[^>]*>([^<]+)<\/a>/giu);
      return Array.from(linkMatches)
        .map((m) => m[1]?.trim())
        .filter((v): v is string => Boolean(v) && v.length > 0);
    };

    const number = extractField("品番") ?? context.number;
    const releaseDate = parseDate(extractField("配信開始日") ?? extractField("発売日")) ?? undefined;
    const studio = extractFieldLinks("メーカー")[0];
    const publisher = extractFieldLinks("レーベル")[0] ?? studio;

    const genres = uniqueStrings(
      $("a[href*='/genre/']")
        .toArray()
        .map((element: CheerioInput) => $(element).text().trim())
        .filter((name: string) => name.length > 0),
    );

    const linkedActors = uniqueStrings(
      $("a[href*='/star/']")
        .toArray()
        .map((element: CheerioInput) => $(element).text().trim())
        .filter((name: string) => name.length > 0),
    );
    const actors =
      linkedActors.length > 0 ? linkedActors : splitActorText(extractField("出演者") ?? extractField("女優"));

    const thumbUrl = $("img.img-responsive").first().attr("src");
    const thumbUrlAbsolute = thumbUrl ? toAbsoluteUrl(JAV321_BASE_URL, thumbUrl) : undefined;

    const sceneImages = uniqueStrings(
      $("a[href*='/snapshot/']")
        .toArray()
        .map((element: CheerioInput) => {
          const href = $(element).attr("href");
          const image = $(element).find("img").first();
          return resolveSnapshotImageUrl(
            href,
            toAbsoluteUrl(JAV321_BASE_URL, image.attr("data-original")),
            toAbsoluteUrl(JAV321_BASE_URL, image.attr("src")),
            toAbsoluteUrl(JAV321_BASE_URL, extractOnErrorFallbackUrl(image.attr("onerror"))),
          );
        }),
    );

    // Extract plot - typically in a multi-level div after the info section
    const plot = extractText($, "div.panel-body div.row div.col-md-12") ?? undefined;

    return {
      title,
      number,
      actors,
      genres,
      studio,
      director: undefined,
      publisher,
      series: undefined,
      plot,
      release_date: releaseDate,
      rating: undefined,
      thumb_url: thumbUrlAbsolute,
      poster_url: undefined,
      fanart_url: undefined,
      scene_images: sceneImages,
      trailer_url: undefined,
      website: Website.JAV321,
    };
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.JAV321,
  crawler: Jav321Crawler,
};
