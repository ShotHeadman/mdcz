import { toErrorMessage } from "@main/utils/common";
import { normalizeDmmNumberVariants } from "@main/utils/dmmImage";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import { type CheerioAPI, load } from "cheerio";

import type { Context, CrawlerInput, SearchPageResolution } from "../../base/types";
import type { CrawlerRegistration } from "../../registration";
import { toAbsoluteUrl } from "../helpers";

import { BaseDmmCrawler } from "./BaseDmmCrawler";
import { isDmmVideoLikeUrl } from "./dmmVideo";
import { classifyDmmDetailFailure } from "./failureClassifier";
import { DmmCategory, parseCategory, parseDigitalDetail, parseMonoLikeDetail } from "./parsers";

interface DmmContext extends Context {
  number00?: string;
  numberNo00?: string;
  searchKeywords: string[];
}

const DMM_SEARCH_BASE = "https://www.dmm.co.jp/search/=/searchstr=";
const DMM_SEARCH_BASE_ALT = "https://www.dmm.com/search/=/searchstr=";

const unescapeDetailUrl = (value: string): string => {
  return value.replaceAll("\\/", "/").replaceAll("\\u0026", "&");
};

const isDmmSearchCandidateDetailUrl = (value: string): boolean => {
  return (
    /\/(?:digital|mono|monthly|rental)\/.*\/-\/detail\//iu.test(value) ||
    value.includes("/detail/=/cid=") ||
    /video\.dmm\.co\.jp\/(?:av|anime)\/content\/\?id=/iu.test(value) ||
    /tv\.dmm\.co\.jp\/list\/?\?content=/iu.test(value)
  );
};

interface DmmSearchCandidate {
  detailUrl: string;
  contentId?: string;
  title?: string;
  order: number;
}

const pushUnique = (values: string[], value: string | undefined): void => {
  if (!value || values.includes(value)) {
    return;
  }

  values.push(value);
};

const buildSearchKeywords = (number: string, number00?: string, numberNo00?: string): string[] => {
  const normalized = number.trim().toLowerCase();
  const keywords: string[] = [];
  pushUnique(keywords, number00);
  pushUnique(keywords, numberNo00);
  pushUnique(keywords, normalized);
  pushUnique(keywords, normalized.replace(/\s+/gu, ""));

  const matched = normalized.match(/(\d*[a-z]+)-?(\d+)/u);
  if (matched) {
    const prefix = matched[1] ?? "";
    const digits = matched[2];
    pushUnique(keywords, `${prefix}-${digits}`);
    pushUnique(keywords, `${prefix}${digits}`);
    pushUnique(keywords, `${prefix}${digits.padStart(5, "0")}`);
  }

  return keywords.filter((keyword) => keyword.length > 0);
};

const buildDetailUrlNeedles = (context: DmmContext): string[] => {
  return Array.from(
    new Set(
      context.searchKeywords
        .map((keyword) => keyword.toLowerCase().replace(/[^a-z0-9]/gu, ""))
        .filter((keyword) => keyword.length > 0),
    ),
  );
};

const extractJsonStringField = (value: string, names: string[]): string | undefined => {
  for (const name of names) {
    const escapedPattern = new RegExp(`${name}\\\\":\\\\"(.*?)\\\\"`, "iu");
    const escapedMatch = value.match(escapedPattern);
    if (escapedMatch?.[1]) {
      return unescapeDetailUrl(escapedMatch[1]);
    }

    const plainPattern = new RegExp(`"${name}"\\s*:\\s*"(.*?)"`, "iu");
    const plainMatch = value.match(plainPattern);
    if (plainMatch?.[1]) {
      return unescapeDetailUrl(plainMatch[1]);
    }
  }

  return undefined;
};

const collectDetailCandidates = (context: DmmContext, $: CheerioAPI, searchUrl: string): DmmSearchCandidate[] => {
  const htmlText = $.html();
  const escapedMatches = htmlText.matchAll(/detailUrl\\":\\"(.*?)\\"/giu);
  const plainMatches = htmlText.matchAll(/"detail(?:Url|URL)"\s*:\s*"(.*?)"/giu);
  const candidates: DmmSearchCandidate[] = [];
  let order = 0;

  const pushCandidate = (
    value: string | undefined,
    metadata: Partial<Omit<DmmSearchCandidate, "detailUrl" | "order">> = {},
  ): void => {
    if (!value) {
      return;
    }
    const parsed = unescapeDetailUrl(value);
    if (parsed.trim().length === 0) {
      return;
    }
    if (!isDmmSearchCandidateDetailUrl(parsed)) {
      return;
    }
    if (candidates.some((candidate) => candidate.detailUrl === parsed)) {
      return;
    }

    candidates.push({
      detailUrl: parsed,
      contentId: metadata.contentId,
      title: metadata.title,
      order,
    });
    order += 1;
  };

  const objectMatches = htmlText.matchAll(/\{[^{}]*(?:"detail(?:Url|URL)"|detailUrl\\":\\")[^{}]*\}/giu);
  for (const match of objectMatches) {
    const objectText = match[0] ?? "";
    pushCandidate(extractJsonStringField(objectText, ["detailUrl", "detailURL"]), {
      contentId: extractJsonStringField(objectText, ["contentId", "contentID"]),
      title: extractJsonStringField(objectText, ["title"]),
    });
  }

  for (const match of escapedMatches) {
    pushCandidate(match[1]);
  }

  for (const match of plainMatches) {
    pushCandidate(match[1]);
  }

  const detailAnchors = $("a[href]")
    .toArray()
    .map((element) => $(element).attr("href"))
    .filter((href): href is string => typeof href === "string")
    .filter(isDmmSearchCandidateDetailUrl);

  for (const href of detailAnchors) {
    pushCandidate(toAbsoluteUrl(searchUrl, href));
  }

  if (candidates.length === 0) {
    return [];
  }

  const needles = buildDetailUrlNeedles(context);
  if (needles.length === 0) {
    return candidates;
  }

  return candidates
    .map((candidate) => {
      const searchable = [candidate.detailUrl, candidate.contentId, candidate.title]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9]/gu, "");
      const matchIndex = needles.findIndex((needle) => searchable.includes(needle));
      return { candidate, matchIndex };
    })
    .filter((item) => item.matchIndex >= 0)
    .sort((a, b) => a.matchIndex - b.matchIndex || a.candidate.order - b.candidate.order)
    .map((item) => item.candidate);
};

export class DmmCrawler extends BaseDmmCrawler {
  site(): Website {
    return Website.DMM;
  }

  protected dmmSiteLabel(): "DMM" {
    return "DMM";
  }

  protected override newContext(input: CrawlerInput): DmmContext {
    const context = super.newContext(input) as DmmContext;
    const variants = normalizeDmmNumberVariants(input.number);
    context.number00 = variants.number00;
    context.numberNo00 = variants.numberNo00;
    context.searchKeywords = buildSearchKeywords(input.number, variants.number00, variants.numberNo00);
    return context;
  }

  protected override async fetch(url: string, context: DmmContext): Promise<string> {
    return this.gateway.fetchHtml(url, this.createFetchOptions(context));
  }

  protected async generateSearchUrl(context: DmmContext): Promise<string | null> {
    const searchUrls = this.buildSearchUrls(context);
    if (searchUrls.length === 0) {
      return null;
    }

    return searchUrls[0] ?? null;
  }

  protected async parseSearchPage(
    context: DmmContext,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    const currentResult = this.resolveDetailUrlFromSearchHtml(context, $, searchUrl);
    if (currentResult) {
      return currentResult;
    }

    for (const candidateSearchUrl of this.buildSearchUrls(context)) {
      if (candidateSearchUrl === searchUrl) {
        continue;
      }

      try {
        const html = await this.gateway.fetchHtml(candidateSearchUrl, this.createFetchOptions(context));
        const candidateResult = this.resolveDetailUrlFromSearchHtml(context, load(html), candidateSearchUrl);
        if (candidateResult) {
          return candidateResult;
        }
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.warn(`DMM search candidate failed for ${candidateSearchUrl}: ${message}`);
      }
    }

    return null;
  }

  protected async parseDetailPage(context: DmmContext, $: CheerioAPI, detailUrl: string): Promise<CrawlerData | null> {
    if (isDmmVideoLikeUrl(detailUrl)) {
      const videoResult = await this.tryDmmVideoDetailUrl(context, detailUrl, Website.DMM, "DMM video GraphQL");
      if (videoResult) {
        return videoResult;
      }
    }

    const titleText = $("title").first().text().trim();
    const h1Text = $("h1#title, h1").first().text().trim();
    const mergedTitle = `${titleText} ${h1Text}`.trim() || undefined;
    const classified = classifyDmmDetailFailure({
      html: $.html(),
      title: mergedTitle,
      detailUrl,
      siteLabel: "DMM",
    });
    if (classified === "DMM: region blocked" || classified === "DMM: login wall") {
      return null;
    }

    const category = parseCategory(detailUrl);
    const baseData = await this.parseCategoryData(category, $);
    if (!baseData || !baseData.title) {
      return null;
    }
    const title = baseData.title;

    const thumbUrl = baseData.thumb_url;
    const posterUrl = baseData.poster_url ?? thumbUrl?.replace("pl.jpg", "ps.jpg");

    return {
      title,
      number: baseData.number ?? context.number,
      actors: baseData.actors ?? [],
      genres: baseData.genres ?? [],
      studio: baseData.studio,
      director: baseData.director,
      publisher: baseData.publisher ?? baseData.studio,
      series: baseData.series,
      plot: baseData.plot,
      release_date: baseData.release_date,
      rating: baseData.rating,
      thumb_url: thumbUrl,
      poster_url: posterUrl,
      fanart_url: baseData.fanart_url,
      scene_images: baseData.scene_images ?? [],
      trailer_url: baseData.trailer_url,
      website: Website.DMM,
    };
  }

  private async parseCategoryData(category: DmmCategory, $: CheerioAPI): Promise<Partial<CrawlerData> | null> {
    if (category === DmmCategory.DIGITAL) {
      return parseDigitalDetail($);
    }

    return parseMonoLikeDetail($);
  }

  private buildSearchUrls(context: DmmContext): string[] {
    return context.searchKeywords.flatMap((keyword) => {
      const encodedKeyword = encodeURIComponent(keyword).replace(/%2D/giu, "-");
      return [
        `${DMM_SEARCH_BASE}${encodedKeyword}/sort=ranking/`,
        `${DMM_SEARCH_BASE_ALT}${encodedKeyword}/sort=ranking/`,
      ];
    });
  }

  private resolveDetailUrlFromSearchHtml(
    context: DmmContext,
    $: CheerioAPI,
    searchUrl: string,
  ): string | SearchPageResolution | null {
    const candidates = collectDetailCandidates(context, $, searchUrl);
    const detailUrl = candidates[0]?.detailUrl;
    if (!detailUrl) {
      return null;
    }

    return isDmmVideoLikeUrl(detailUrl) ? this.reuseSearchDocument(detailUrl) : detailUrl;
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.DMM,
  crawler: DmmCrawler,
};
