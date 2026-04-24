import { toErrorMessage } from "@main/utils/common";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { type CheerioAPI, load } from "cheerio";

import type { Context, CrawlerInput, CrawlerResponse, SearchPageResolution } from "../../base/types";
import type { CrawlerRegistration } from "../../registration";
import { toAbsoluteUrl } from "../helpers";
import { BaseDmmCrawler } from "./BaseDmmCrawler";
import { normalizeContentIds } from "./contentId";
import {
  buildDmmVideoDetailUrl,
  buildDmmVideoSearchPayload,
  DMM_VIDEO_BASE,
  DMM_VIDEO_GRAPHQL_ENDPOINT,
  type DmmVideoDetailPath,
  getAlternativeDmmVideoDetailUrls,
  getDmmVideoContentIdsFromUrl,
  isDmmVideoDetailUrl,
  normalizeDmmVideoToken,
  pickDmmVideoSearchResultContentId,
  toDmmVideoCrawlerData,
} from "./dmmVideo";
import { parseDigitalDetail } from "./parsers";

interface DmmTvContext extends Context {
  candidateIds: string[];
  searchTerms: string[];
}

const appendUnique = (values: string[], value: string | undefined): void => {
  if (!value || values.includes(value)) {
    return;
  }

  values.push(value);
};

const buildSearchTerms = (number: string, candidateIds: string[]): string[] => {
  const normalized = number.trim().toLowerCase();
  const terms: string[] = [];
  appendUnique(terms, normalized);
  appendUnique(terms, normalized.replace(/\s+/gu, ""));
  appendUnique(terms, normalized.replace(/[^a-z0-9]/gu, ""));

  const matched = normalized.match(/(\d*[a-z]+)-?(\d+)/u);
  if (matched) {
    const prefix = matched[1] ?? "";
    const digits = matched[2];
    appendUnique(terms, `${prefix}-${digits}`);
    appendUnique(terms, `${prefix}${digits}`);
    appendUnique(terms, `${prefix}${digits.padStart(5, "0")}`);
  }

  for (const candidateId of candidateIds) {
    appendUnique(terms, candidateId);
    appendUnique(terms, candidateId.replace(/^1(?=[a-z])/u, ""));
  }

  return terms.filter((term) => term.length > 0);
};

export class DmmTvCrawler extends BaseDmmCrawler {
  site(): Website {
    return Website.DMM_TV;
  }

  protected dmmSiteLabel(): "DMM_TV" {
    return "DMM_TV";
  }

  override async crawl(input: CrawlerInput): Promise<CrawlerResponse> {
    const startedAt = Date.now();
    const context = this.newContext(input);

    const graphQlResult = await this.tryGraphQL(context);
    if (graphQlResult) {
      return {
        input,
        result: {
          success: true,
          data: graphQlResult,
        },
        elapsedMs: Date.now() - startedAt,
      };
    }

    if (!context.options.detailUrl) {
      const currentDetailUrl = context.candidateIds[0] ? buildDmmVideoDetailUrl(context.candidateIds[0]) : "";
      const searchedDetailUrl = await this.tryResolveDetailUrlViaSearch(context, currentDetailUrl);
      if (searchedDetailUrl) {
        try {
          const searchedResult = await this.tryDetailUrl(context, searchedDetailUrl);
          if (searchedResult) {
            return {
              input,
              result: {
                success: true,
                data: searchedResult,
              },
              elapsedMs: Date.now() - startedAt,
            };
          }
        } catch (error) {
          const message = toErrorMessage(error);
          this.logger.debug(`DMM TV GraphQL-first searched detail miss for ${searchedDetailUrl}: ${message}`);
        }
      }
    }

    return super.crawl(input);
  }

  protected override newContext(input: CrawlerInput): DmmTvContext {
    const context = super.newContext(input) as DmmTvContext;
    const detailContentIds = input.options?.detailUrl ? getDmmVideoContentIdsFromUrl(input.options.detailUrl) : [];
    context.candidateIds = Array.from(
      new Set([...detailContentIds, ...normalizeContentIds(input.number)].filter((value) => value.length > 0)),
    );
    context.searchTerms = buildSearchTerms(input.number, context.candidateIds);
    return context;
  }

  protected override async fetch(url: string, context: DmmTvContext): Promise<string> {
    try {
      return await this.gateway.fetchHtml(url, this.createFetchOptions(context));
    } catch (error) {
      for (const fallbackUrl of getAlternativeDmmVideoDetailUrls(url)) {
        try {
          return await this.gateway.fetchHtml(fallbackUrl, this.createFetchOptions(context));
        } catch (fallbackError) {
          const message = toErrorMessage(fallbackError);
          this.logger.debug(`DMM TV detail fallback miss for ${fallbackUrl}: ${message}`);
        }
      }

      throw error;
    }
  }

  protected async generateSearchUrl(context: DmmTvContext): Promise<string | null> {
    const firstCandidate = context.candidateIds[0];
    if (!firstCandidate) {
      return null;
    }

    return buildDmmVideoDetailUrl(firstCandidate);
  }

  protected async parseSearchPage(
    context: DmmTvContext,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    if (isDmmVideoDetailUrl(searchUrl)) {
      return this.reuseSearchDocument(searchUrl);
    }

    const links = new Set<string>();

    $(
      "a[href*='/av/content/?id='], a[href*='video.dmm.co.jp/av/content/?id='], a[href*='/anime/content/?id='], a[href*='video.dmm.co.jp/anime/content/?id=']",
    )
      .toArray()
      .map((element) => $(element).attr("href"))
      .filter((href): href is string => Boolean(href))
      .forEach((href) => {
        const absolute = toAbsoluteUrl(DMM_VIDEO_BASE, href);
        if (absolute) {
          links.add(absolute);
        }
      });

    const html = $.html();
    for (const match of html.matchAll(/\/(?:av|anime)\/content\/\?id=([a-z0-9_]+)/giu)) {
      const id = match[1];
      if (id) {
        const matchedUrl = match[0];
        if (matchedUrl.includes("/anime/")) {
          links.add(buildDmmVideoDetailUrl(id, "/anime/content/?id="));
        } else {
          links.add(buildDmmVideoDetailUrl(id));
        }
      }
    }

    if (links.size > 0) {
      const ordered = Array.from(links);
      const rankByCandidate = (url: string): number => {
        const normalizedUrl = normalizeDmmVideoToken(url);
        for (const [index, candidate] of context.candidateIds.entries()) {
          if (normalizedUrl.includes(normalizeDmmVideoToken(candidate))) {
            return index;
          }
        }
        return Number.MAX_SAFE_INTEGER;
      };

      const best = ordered
        .map((url) => ({ url, rank: rankByCandidate(url) }))
        .sort((a, b) => a.rank - b.rank)
        .map((item) => item.url)[0];

      return best ?? ordered[0] ?? null;
    }

    if (context.candidateIds.length > 0) {
      return buildDmmVideoDetailUrl(context.candidateIds[0]);
    }

    return null;
  }

  protected async parseDetailPage(
    context: DmmTvContext,
    $: CheerioAPI,
    detailUrl: string,
  ): Promise<CrawlerData | null> {
    const htmlResult = toDmmVideoCrawlerData(parseDigitalDetail($), context.number, Website.DMM_TV);
    if (htmlResult) {
      return htmlResult;
    }

    for (const fallbackUrl of getAlternativeDmmVideoDetailUrls(detailUrl)) {
      try {
        const fallbackResult = await this.tryDetailUrl(context, fallbackUrl);
        if (fallbackResult) {
          return fallbackResult;
        }
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.debug(`DMM TV detail parse fallback miss for ${fallbackUrl}: ${message}`);
      }
    }

    return null;
  }

  private async tryGraphQL(context: DmmTvContext): Promise<CrawlerData | null> {
    const candidateIds = Array.from(
      new Set(context.candidateIds.length > 0 ? context.candidateIds : normalizeContentIds(context.number)),
    );

    return this.tryDmmVideoContentIds(context, candidateIds, Website.DMM_TV, "DMM TV GraphQL");
  }

  private async tryDetailUrl(context: DmmTvContext, detailUrl: string): Promise<CrawlerData | null> {
    const graphQlResult = await this.tryDmmVideoDetailUrl(context, detailUrl, Website.DMM_TV, "DMM TV detail GraphQL");
    if (graphQlResult) {
      return graphQlResult;
    }

    const html = await this.gateway.fetchHtml(detailUrl, this.createFetchOptions(context));
    return toDmmVideoCrawlerData(parseDigitalDetail(load(html)), context.number, Website.DMM_TV);
  }

  private async tryResolveDetailUrlViaSearch(context: DmmTvContext, currentDetailUrl: string): Promise<string | null> {
    const options = this.createDmmVideoGraphQlFetchOptions(context);
    const strategies: Array<{ floor: "AV" | "ANIME"; path: DmmVideoDetailPath }> = [
      { floor: "AV", path: "/av/content/?id=" },
      { floor: "ANIME", path: "/anime/content/?id=" },
    ];

    for (const strategy of strategies) {
      for (const term of context.searchTerms) {
        try {
          const response = await this.gateway.fetchGraphQL<unknown>(
            DMM_VIDEO_GRAPHQL_ENDPOINT,
            buildDmmVideoSearchPayload(strategy.floor, term),
            options,
          );
          const contentId = pickDmmVideoSearchResultContentId(context, response);
          if (!contentId) {
            continue;
          }

          const detailUrl = buildDmmVideoDetailUrl(contentId, strategy.path);
          if (detailUrl !== currentDetailUrl) {
            return detailUrl;
          }
        } catch (error) {
          const message = toErrorMessage(error);
          this.logger.debug(`DMM VIDEO search miss for ${strategy.floor}/${term}: ${message}`);
        }
      }
    }

    return null;
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.DMM_TV,
  crawler: DmmTvCrawler,
};
