import { uniqueStrings } from "@mdcz/runtime/shared";
import type { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";

import type { FetchOptions, GraphQLOperation } from "../../FetchGateway";
import { normalizeContentIds } from "./contentId";

export const DMM_VIDEO_BASE = "https://video.dmm.co.jp";
export const DMM_VIDEO_GRAPHQL_ENDPOINT = "https://api.video.dmm.co.jp/graphql";
export const DMM_VIDEO_DETAIL_PATHS = ["/av/content/?id=", "/anime/content/?id="] as const;

export type DmmVideoDetailPath = (typeof DMM_VIDEO_DETAIL_PATHS)[number];

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

export const normalizeDmmVideoToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, "");

export const buildDmmVideoDetailUrl = (contentId: string, path: DmmVideoDetailPath = "/av/content/?id="): string =>
  `${DMM_VIDEO_BASE}${path}${contentId}`;

export const isDmmVideoDetailUrl = (url: string): boolean => {
  return DMM_VIDEO_DETAIL_PATHS.some((path) => url.includes(`video.dmm.co.jp${path}`));
};

export const getDmmVideoContentId = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "video.dmm.co.jp") {
      return null;
    }

    const isDetailPath = DMM_VIDEO_DETAIL_PATHS.some((path) => parsed.pathname === path.split("?")[0]);
    if (!isDetailPath) {
      return null;
    }

    return parsed.searchParams.get("id")?.trim() || null;
  } catch {
    for (const path of DMM_VIDEO_DETAIL_PATHS) {
      const marker = `${DMM_VIDEO_BASE}${path}`;
      if (url.startsWith(marker)) {
        return url.slice(marker.length).trim() || null;
      }
    }
  }

  return null;
};

export const isDmmTvListUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "tv.dmm.co.jp" && parsed.pathname.replace(/\/+$/u, "") === "/list";
  } catch {
    return url.includes("tv.dmm.co.jp/list/?content=");
  }
};

export const isDmmVideoLikeUrl = (url: string): boolean => isDmmVideoDetailUrl(url) || isDmmTvListUrl(url);

export const getDmmVideoContentIdsFromUrl = (url: string): string[] => {
  const videoContentId = getDmmVideoContentId(url);
  if (videoContentId) {
    return [videoContentId];
  }

  if (!isDmmTvListUrl(url)) {
    return [];
  }

  try {
    const contentId = new URL(url).searchParams.get("content")?.trim().toLowerCase();
    if (!contentId) {
      return [];
    }

    return Array.from(new Set([...normalizeContentIds(contentId), contentId].filter((item) => item.length > 0)));
  } catch {
    const matched = url.match(/[?&]content=([^&#]+)/iu);
    const contentId = matched?.[1] ? decodeURIComponent(matched[1]).trim().toLowerCase() : "";
    return contentId
      ? Array.from(new Set([...normalizeContentIds(contentId), contentId].filter((item) => item.length > 0)))
      : [];
  }
};

export const getAlternativeDmmVideoDetailUrls = (url: string): string[] => {
  const contentId = getDmmVideoContentId(url);
  if (!contentId) {
    return [];
  }

  return DMM_VIDEO_DETAIL_PATHS.map((path) => buildDmmVideoDetailUrl(contentId, path)).filter(
    (candidate) => candidate !== url,
  );
};

export const buildDmmVideoPayload = (id: string): GraphQLOperation => {
  return {
    operationName: "ContentPageData",
    query: CONTENT_PAGE_DATA_QUERY,
    variables: {
      id,
      shouldFetchRelatedTags: true,
    },
  };
};

export const buildDmmVideoSearchPayload = (floor: "AV" | "ANIME", queryWord: string): GraphQLOperation => {
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

export const buildDmmVideoGraphQlFetchOptions = (baseOptions: FetchOptions): FetchOptions => {
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
};

export const pickDmmVideoSearchResultContentId = (
  input: { number: string; searchTerms: string[]; candidateIds: string[] },
  payload: unknown,
): string | null => {
  const contents = ((payload as DmmVideoSearchResponse)?.legacySearchPPV?.result?.contents ?? []).filter(
    (item): item is { id: string; title?: string } => Boolean(item?.id),
  );
  if (contents.length === 0) {
    return null;
  }

  const needles = Array.from(
    new Set(
      [input.number, ...input.searchTerms, ...input.candidateIds]
        .map((value) => normalizeDmmVideoToken(value))
        .filter((value) => value.length > 0),
    ),
  );

  const candidates = contents.map((item) => ({
    id: item.id,
    normalizedId: normalizeDmmVideoToken(item.id),
    normalizedTitle: normalizeDmmVideoToken(item.title ?? ""),
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

export const parseDmmVideoData = (payload: unknown, fallbackNumber: string): Partial<CrawlerData> | null => {
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

export const toDmmVideoCrawlerData = (
  data: Partial<CrawlerData> | null | undefined,
  fallbackNumber: string,
  website: Website.DMM | Website.DMM_TV,
): CrawlerData | null => {
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
    website,
  };
};
