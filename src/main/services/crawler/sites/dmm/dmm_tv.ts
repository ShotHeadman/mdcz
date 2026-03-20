import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import type { Context, CrawlerInput, SearchPageResolution } from "../../base/types";
import type { FetchOptions } from "../../FetchGateway";
import { toAbsoluteUrl } from "../helpers";
import { BaseDmmCrawler } from "./BaseDmmCrawler";
import { normalizeContentIds } from "./contentId";
import { parseDigitalDetail } from "./parsers";

interface DmmTvContext extends Context {
  candidateIds: string[];
}

const DMM_VIDEO_BASE = "https://video.dmm.co.jp";
const DMM_VIDEO_GRAPHQL_ENDPOINT = "https://api.video.dmm.co.jp/graphql";

interface DmmVideoPayload {
  operationName: string;
  query: string;
  variables: Record<string, string>;
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
    packageImage?: { largeUrl?: string; mediumUrl?: string };
    sampleImages?: Array<{ largeImageUrl?: string }>;
    sample2DMovie?: { highestMovieUrl?: string; hlsMovieUrl?: string };
  };
  reviewSummary?: { average?: number };
}

const CONTENT_PAGE_DATA_QUERY =
  "query ContentPageData($id: ID!) { ppvContent(id: $id) { title description makerContentId makerReleasedAt deliveryStartDate duration packageImage { largeUrl mediumUrl } sampleImages { largeImageUrl } sample2DMovie { highestMovieUrl hlsMovieUrl } actresses { name } directors { name } series { name } maker { name } label { name } genres { name } } reviewSummary(contentId: $id) { average } }";

const buildDetailUrl = (contentId: string): string => `${DMM_VIDEO_BASE}/av/content/?id=${contentId}`;

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, "");

const isVideoDetailUrl = (url: string): boolean => {
  return url.includes("video.dmm.co.jp/av/content/?id=");
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
    },
  };
};

const parseDmmVideoData = (payload: unknown, fallbackNumber: string): Partial<CrawlerData> | null => {
  const data = (payload as { data?: DmmVideoDataResponse })?.data ?? (payload as DmmVideoDataResponse);
  const content = data?.ppvContent;
  if (!content?.title) {
    return null;
  }

  const number = content.makerContentId?.trim() || fallbackNumber;
  const trailer =
    content.sample2DMovie?.highestMovieUrl ?? buildTrailerFromPlaylist(content.sample2DMovie?.hlsMovieUrl);

  return {
    title: content.title,
    number,
    durationSeconds: typeof content.duration === "number" && content.duration > 0 ? content.duration : undefined,
    actors: (content.actresses ?? []).map((item) => item.name).filter((value): value is string => Boolean(value)),
    genres: (content.genres ?? []).map((item) => item.name).filter((value): value is string => Boolean(value)),
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
    return context;
  }

  protected override async fetch(url: string, context: DmmTvContext): Promise<string> {
    return this.gateway.fetchHtml(url, this.createFetchOptions(context));
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

    $("a[href*='/av/content/?id='], a[href*='video.dmm.co.jp/av/content/?id=']")
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
    for (const match of html.matchAll(/\/av\/content\/\?id=([a-z0-9]+)/giu)) {
      const id = match[1];
      if (id) {
        links.add(buildDetailUrl(id));
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
    _detailUrl: string,
  ): Promise<CrawlerData | null> {
    const graphQlData = await this.tryGraphQL(context);
    if (graphQlData?.title && !hasLoginWallTitle(graphQlData.title)) {
      return {
        title: graphQlData.title,
        number: graphQlData.number ?? context.number,
        durationSeconds: graphQlData.durationSeconds,
        actors: graphQlData.actors ?? [],
        genres: graphQlData.genres ?? [],
        studio: graphQlData.studio,
        director: graphQlData.director,
        publisher: graphQlData.publisher ?? graphQlData.studio,
        series: graphQlData.series,
        plot: graphQlData.plot,
        release_date: graphQlData.release_date,
        rating: graphQlData.rating,
        thumb_url: graphQlData.thumb_url,
        poster_url: graphQlData.poster_url,
        fanart_url: graphQlData.fanart_url,
        scene_images: graphQlData.scene_images ?? [],
        trailer_url: graphQlData.trailer_url,
        website: Website.DMM_TV,
      };
    }

    const parsed = parseDigitalDetail($);
    if (!parsed?.title || hasLoginWallTitle(parsed.title)) {
      return null;
    }

    return {
      title: parsed.title,
      number: context.number,
      durationSeconds: parsed.durationSeconds,
      actors: parsed.actors ?? [],
      genres: parsed.genres ?? [],
      studio: parsed.studio,
      director: parsed.director,
      publisher: parsed.publisher ?? parsed.studio,
      series: parsed.series,
      plot: parsed.plot,
      release_date: parsed.release_date,
      rating: parsed.rating,
      thumb_url: parsed.thumb_url,
      poster_url: parsed.poster_url,
      fanart_url: parsed.fanart_url,
      scene_images: parsed.scene_images ?? [],
      trailer_url: parsed.trailer_url,
      website: Website.DMM_TV,
    };
  }

  private async tryGraphQL(context: DmmTvContext): Promise<Partial<CrawlerData> | null> {
    const baseOptions = this.createFetchOptions(context);
    const graphQlTimeout = Math.min(baseOptions.timeout ?? 20_000, 2_500);
    const options: FetchOptions = {
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
    const candidateIds = Array.from(
      new Set(context.candidateIds.length > 0 ? context.candidateIds : normalizeContentIds(context.number)),
    );

    for (const contentId of candidateIds) {
      try {
        const videoResponse = await this.gateway.fetchGraphQL<unknown>(
          DMM_VIDEO_GRAPHQL_ENDPOINT,
          buildDmmVideoPayload(contentId),
          options,
        );
        const videoData = parseDmmVideoData(videoResponse, context.number);
        if (videoData?.title) {
          return videoData;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.debug(`DMM VIDEO GraphQL miss for ${contentId}: ${message}`);
      }
    }

    return null;
  }
}
