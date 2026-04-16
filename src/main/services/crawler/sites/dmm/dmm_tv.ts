import { toErrorMessage } from "@main/utils/common";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { type CheerioAPI, load } from "cheerio";

import type { Context, CrawlerInput, SearchPageResolution } from "../../base/types";
import type { FetchOptions } from "../../FetchGateway";
import type { CrawlerRegistration } from "../../registration";
import { toAbsoluteUrl, uniqueStrings } from "../helpers";
import { BaseDmmCrawler } from "./BaseDmmCrawler";
import { normalizeContentIds } from "./contentId";
import { parseDigitalDetail } from "./parsers";

interface DmmTvContext extends Context {
  candidateIds: string[];
  searchTerms: string[];
}

const DMM_VIDEO_BASE = "https://video.dmm.co.jp";
const DMM_VIDEO_GRAPHQL_ENDPOINT = "https://api.video.dmm.co.jp/graphql";
const DMM_VIDEO_DETAIL_PATHS = ["/av/content/?id=", "/anime/content/?id="] as const;

type DmmVideoDetailPath = (typeof DMM_VIDEO_DETAIL_PATHS)[number];

interface DmmVideoPayload {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
}

interface DmmVideoSearchPayload {
  operationName: string;
  query: string;
  variables: {
    limit: number;
    offset: number;
    floor: "AV" | "ANIME";
    sort: "SALES_RANK_SCORE";
    queryWord: string;
    facetLimit: number;
    excludeUndelivered: boolean;
  };
}

interface DmmVideoDataResponse {
  ppvContent?: {
    title?: string;
    description?: string;
    makerContentId?: string;
    makerReleasedAt?: string;
    deliveryStartDate?: string;
    duration?: number;
    actresses?: Array<{ name?: string }>;
    directors?: Array<{ name?: string }>;
    series?: { name?: string };
    maker?: { name?: string };
    label?: { name?: string };
    genres?: Array<{ name?: string }>;
    relatedTags?: Array<
      | {
          tags?: Array<{ name?: string }>;
        }
      | {
          name?: string;
        }
    >;
    packageImage?: { largeUrl?: string; mediumUrl?: string };
    sampleImages?: Array<{ largeImageUrl?: string }>;
    sample2DMovie?: { highestMovieUrl?: string; hlsMovieUrl?: string };
  };
  reviewSummary?: { average?: number };
}

interface DmmVideoSearchResponse {
  legacySearchPPV?: {
    result?: {
      contents?: Array<{
        id?: string;
        title?: string;
        contentType?: string;
      }>;
    };
  };
}

const CONTENT_PAGE_DATA_QUERY =
  "query ContentPageData($id: ID!, $shouldFetchRelatedTags: Boolean = true) { ppvContent(id: $id) { title description makerContentId makerReleasedAt deliveryStartDate duration packageImage { largeUrl mediumUrl } sampleImages { largeImageUrl } sample2DMovie { highestMovieUrl hlsMovieUrl } actresses { name } directors { name } series { name } maker { name } label { name } genres { name } relatedTags(limit: 16) @include(if: $shouldFetchRelatedTags) { ... on ContentTagGroup { tags { name } } ... on ContentTag { name } } } reviewSummary(contentId: $id) { average } }";

const buildDetailUrl = (contentId: string, path: DmmVideoDetailPath = "/av/content/?id="): string =>
  `${DMM_VIDEO_BASE}${path}${contentId}`;

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, "");

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

const isVideoDetailUrl = (url: string): boolean => {
  return DMM_VIDEO_DETAIL_PATHS.some((path) => url.includes(`video.dmm.co.jp${path}`));
};

const getVideoDetailContentId = (url: string): string | null => {
  for (const path of DMM_VIDEO_DETAIL_PATHS) {
    const marker = `${DMM_VIDEO_BASE}${path}`;
    if (url.startsWith(marker)) {
      return url.slice(marker.length).trim() || null;
    }
  }

  return null;
};

const getAlternativeDetailUrls = (url: string): string[] => {
  const contentId = getVideoDetailContentId(url);
  if (!contentId) {
    return [];
  }

  return DMM_VIDEO_DETAIL_PATHS.map((path) => buildDetailUrl(contentId, path)).filter((candidate) => candidate !== url);
};

const hasLoginWallTitle = (title: string | undefined): boolean => {
  if (!title) {
    return false;
  }

  return /fanza\s*ログイン|ログイン|login/iu.test(title);
};

const buildTrailerFromPlaylist = (playlistUrl: string | undefined): string | undefined => {
  if (!playlistUrl) {
    return undefined;
  }

  const liteVideo = playlistUrl.replace("hlsvideo", "litevideo");
  const match = liteVideo.match(/\/([^/]+)\/playlist\.m3u8$/u);
  if (!match) {
    return liteVideo;
  }

  return liteVideo.replace("playlist.m3u8", `${match[1]}_sm_w.mp4`);
};

const buildDmmVideoPayload = (id: string): DmmVideoPayload => {
  return {
    operationName: "ContentPageData",
    query: CONTENT_PAGE_DATA_QUERY,
    variables: {
      id,
      shouldFetchRelatedTags: true,
    },
  };
};

const buildDmmVideoSearchPayload = (floor: "AV" | "ANIME", queryWord: string): DmmVideoSearchPayload => {
  const operationName = floor === "ANIME" ? "AnimeSearch" : "AvSearch";
  const query = `query ${operationName}($limit: Int!, $offset: Int, $floor: PPVFloor, $sort: ContentSearchPPVSort!, $queryWord: String, $facetLimit: Int!, $excludeUndelivered: Boolean!) { legacySearchPPV(limit: $limit, offset: $offset, floor: $floor, sort: $sort, queryWord: $queryWord, facetLimit: $facetLimit, includeExplicit: true, excludeUndelivered: $excludeUndelivered) { result { contents { id title contentType } } } }`;

  return {
    operationName,
    query,
    variables: {
      limit: 5,
      offset: 0,
      floor,
      sort: "SALES_RANK_SCORE",
      queryWord,
      facetLimit: 1,
      excludeUndelivered: false,
    },
  };
};

const pickSearchResultContentId = (context: DmmTvContext, payload: unknown): string | null => {
  const contents = ((payload as DmmVideoSearchResponse)?.legacySearchPPV?.result?.contents ?? []).filter(
    (item): item is { id: string; title?: string } => Boolean(item?.id),
  );
  if (contents.length === 0) {
    return null;
  }

  const needles = Array.from(
    new Set(
      [context.number, ...context.searchTerms, ...context.candidateIds]
        .map((value) => normalizeToken(value))
        .filter((value) => value.length > 0),
    ),
  );

  const candidates = contents.map((item) => ({
    id: item.id,
    normalizedId: normalizeToken(item.id),
    normalizedTitle: normalizeToken(item.title ?? ""),
  }));

  for (const candidate of candidates) {
    if (needles.includes(candidate.normalizedId)) {
      return candidate.id;
    }
  }

  for (const candidate of candidates) {
    if (needles.includes(candidate.normalizedTitle)) {
      return candidate.id;
    }
  }

  for (const candidate of candidates) {
    if (needles.some((needle) => candidate.normalizedId.includes(needle))) {
      return candidate.id;
    }
  }

  for (const candidate of candidates) {
    if (needles.some((needle) => candidate.normalizedTitle.includes(needle))) {
      return candidate.id;
    }
  }

  return null;
};

const parseDmmVideoData = (payload: unknown, fallbackNumber: string): Partial<CrawlerData> | null => {
  const data = (payload as { data?: DmmVideoDataResponse })?.data ?? (payload as DmmVideoDataResponse);
  const content = data?.ppvContent;
  if (!content?.title) {
    return null;
  }

  const relatedTags = uniqueStrings(
    (content.relatedTags ?? []).flatMap((item) => {
      if ("tags" in item && Array.isArray(item.tags)) {
        return item.tags.map((tag) => tag.name);
      }

      return "name" in item ? [item.name] : [];
    }),
  );
  const genres = uniqueStrings([...(content.genres ?? []).map((item) => item.name), ...relatedTags]).filter(
    (value): value is string => Boolean(value),
  );

  const number = content.makerContentId?.trim() || fallbackNumber;
  const trailer =
    content.sample2DMovie?.highestMovieUrl ?? buildTrailerFromPlaylist(content.sample2DMovie?.hlsMovieUrl);

  return {
    title: content.title,
    number,
    durationSeconds: typeof content.duration === "number" && content.duration > 0 ? content.duration : undefined,
    actors: (content.actresses ?? []).map((item) => item.name).filter((value): value is string => Boolean(value)),
    genres,
    studio: content.maker?.name,
    director: (content.directors ?? []).map((item) => item.name).find((value): value is string => Boolean(value)),
    publisher: content.label?.name ?? content.maker?.name,
    series: content.series?.name,
    plot: content.description,
    release_date: content.makerReleasedAt?.slice(0, 10) ?? content.deliveryStartDate?.slice(0, 10),
    rating: data?.reviewSummary?.average,
    thumb_url: content.packageImage?.largeUrl,
    poster_url: content.packageImage?.mediumUrl,
    scene_images: (content.sampleImages ?? [])
      .map((item) => item.largeImageUrl)
      .filter((value): value is string => Boolean(value)),
    trailer_url: trailer,
  };
};

const toCrawlerData = (data: Partial<CrawlerData> | null | undefined, fallbackNumber: string): CrawlerData | null => {
  if (!data?.title || hasLoginWallTitle(data.title)) {
    return null;
  }

  return {
    title: data.title,
    number: data.number ?? fallbackNumber,
    durationSeconds: data.durationSeconds,
    actors: data.actors ?? [],
    genres: data.genres ?? [],
    studio: data.studio,
    director: data.director,
    publisher: data.publisher ?? data.studio,
    series: data.series,
    plot: data.plot,
    release_date: data.release_date,
    rating: data.rating,
    thumb_url: data.thumb_url,
    poster_url: data.poster_url,
    fanart_url: data.fanart_url,
    scene_images: data.scene_images ?? [],
    trailer_url: data.trailer_url,
    website: Website.DMM_TV,
  };
};

export class DmmTvCrawler extends BaseDmmCrawler {
  site(): Website {
    return Website.DMM_TV;
  }

  protected dmmSiteLabel(): "DMM_TV" {
    return "DMM_TV";
  }

  protected override newContext(input: CrawlerInput): DmmTvContext {
    const context = super.newContext(input) as DmmTvContext;
    context.candidateIds = normalizeContentIds(input.number);
    context.searchTerms = buildSearchTerms(input.number, context.candidateIds);
    return context;
  }

  protected override async fetch(url: string, context: DmmTvContext): Promise<string> {
    try {
      return await this.gateway.fetchHtml(url, this.createFetchOptions(context));
    } catch (error) {
      for (const fallbackUrl of getAlternativeDetailUrls(url)) {
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

    return buildDetailUrl(firstCandidate);
  }

  protected async parseSearchPage(
    context: DmmTvContext,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    if (isVideoDetailUrl(searchUrl)) {
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
          links.add(buildDetailUrl(id, "/anime/content/?id="));
        } else {
          links.add(buildDetailUrl(id));
        }
      }
    }

    if (links.size > 0) {
      const ordered = Array.from(links);
      const rankByCandidate = (url: string): number => {
        const normalizedUrl = normalizeToken(url);
        for (const [index, candidate] of context.candidateIds.entries()) {
          if (normalizedUrl.includes(normalizeToken(candidate))) {
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
      return buildDetailUrl(context.candidateIds[0]);
    }

    return null;
  }

  protected async parseDetailPage(
    context: DmmTvContext,
    $: CheerioAPI,
    detailUrl: string,
  ): Promise<CrawlerData | null> {
    const graphQlResult = toCrawlerData(await this.tryGraphQL(context), context.number);
    if (graphQlResult) {
      return graphQlResult;
    }

    const htmlResult = toCrawlerData(parseDigitalDetail($), context.number);
    if (htmlResult) {
      return htmlResult;
    }

    const searchedDetailUrl = await this.tryResolveDetailUrlViaSearch(context, detailUrl);
    if (searchedDetailUrl && searchedDetailUrl !== detailUrl) {
      try {
        const searchedResult = await this.tryDetailUrl(context, searchedDetailUrl);
        if (searchedResult) {
          return searchedResult;
        }
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.debug(`DMM TV searched detail miss for ${searchedDetailUrl}: ${message}`);
      }
    }

    for (const fallbackUrl of getAlternativeDetailUrls(detailUrl)) {
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

  private createGraphQlFetchOptions(context: DmmTvContext): FetchOptions {
    const baseOptions = this.createFetchOptions(context);
    const graphQlTimeout = Math.min(baseOptions.timeout ?? 20_000, 2_500);
    return {
      ...baseOptions,
      timeout: graphQlTimeout,
      headers: {
        ...(baseOptions.headers ?? {}),
        referer: "https://video.dmm.co.jp/",
        origin: "https://video.dmm.co.jp",
        "fanza-device": "BROWSER",
        accept: "application/graphql-response+json, application/graphql+json, application/json",
      },
    };
  }

  private async tryGraphQL(context: DmmTvContext): Promise<Partial<CrawlerData> | null> {
    const candidateIds = Array.from(
      new Set(context.candidateIds.length > 0 ? context.candidateIds : normalizeContentIds(context.number)),
    );

    for (const contentId of candidateIds) {
      try {
        const videoData = await this.fetchGraphQlVideoData(context, contentId);
        if (videoData?.title) {
          return videoData;
        }
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.debug(`DMM VIDEO GraphQL miss for ${contentId}: ${message}`);
      }
    }

    return null;
  }

  private async fetchGraphQlVideoData(
    context: DmmTvContext,
    contentId: string,
    fallbackNumber: string = context.number,
  ): Promise<Partial<CrawlerData> | null> {
    const videoResponse = await this.gateway.fetchGraphQL<unknown>(
      DMM_VIDEO_GRAPHQL_ENDPOINT,
      buildDmmVideoPayload(contentId),
      this.createGraphQlFetchOptions(context),
    );
    return parseDmmVideoData(videoResponse, fallbackNumber);
  }

  private async tryDetailUrl(context: DmmTvContext, detailUrl: string): Promise<CrawlerData | null> {
    const contentId = getVideoDetailContentId(detailUrl);
    if (contentId) {
      const graphQlResult = toCrawlerData(await this.fetchGraphQlVideoData(context, contentId), context.number);
      if (graphQlResult) {
        return graphQlResult;
      }
    }

    const html = await this.gateway.fetchHtml(detailUrl, this.createFetchOptions(context));
    return toCrawlerData(parseDigitalDetail(load(html)), context.number);
  }

  private async tryResolveDetailUrlViaSearch(context: DmmTvContext, currentDetailUrl: string): Promise<string | null> {
    const options = this.createGraphQlFetchOptions(context);
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
          const contentId = pickSearchResultContentId(context, response);
          if (!contentId) {
            continue;
          }

          const detailUrl = buildDetailUrl(contentId, strategy.path);
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
