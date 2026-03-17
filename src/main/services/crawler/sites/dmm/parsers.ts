import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { extractAttr, extractList, extractText, parseDate } from "../../base/parser";
import { uniqueStrings } from "../helpers";
import { readFirstJsonLdRecord } from "../jsonLd";

export enum DmmCategory {
  DIGITAL = "digital",
  PRIME = "prime",
  MONTHLY = "monthly",
  MONO = "mono",
  RENTAL = "rental",
  OTHER = "other",
}

type CheerioInput = Parameters<CheerioAPI>[0];
const DMM_SAMPLE_IMAGE_PATTERN = /jp-\d+\.(?:jpe?g|png|webp)$/iu;
const DMM_PRIMARY_IMAGE_PATTERN = /p[sl]\.(?:jpe?g|png|webp)$/iu;

const normalizeDmmSampleImageUrl = (value: string | undefined): string | undefined => {
  if (!value || DMM_PRIMARY_IMAGE_PATTERN.test(value)) {
    return undefined;
  }

  if (DMM_SAMPLE_IMAGE_PATTERN.test(value)) {
    return value;
  }

  const normalized = value.replace(/-(\d+)\.(jpe?g|png|webp)$/iu, "jp-$1.$2");
  return DMM_SAMPLE_IMAGE_PATTERN.test(normalized) ? normalized : undefined;
};

export interface DmmJsonLd {
  aggregateRating?: { ratingValue?: number };
  brand?: { name?: string };
  description?: string;
  image?: string[];
  name?: string;
  subjectOf?: {
    actor?: Array<{ name?: string }>;
    contentUrl?: string;
    genre?: string[];
    uploadDate?: string;
  };
}

export const parseCategory = (detailUrl: string): DmmCategory => {
  if (detailUrl.includes("/digital/") || detailUrl.includes("video.dmm.co.jp")) {
    return DmmCategory.DIGITAL;
  }

  if (detailUrl.includes("/prime/")) {
    return DmmCategory.PRIME;
  }

  if (detailUrl.includes("/monthly/")) {
    return DmmCategory.MONTHLY;
  }

  if (detailUrl.includes("/mono/")) {
    return DmmCategory.MONO;
  }

  if (detailUrl.includes("/rental/")) {
    return DmmCategory.RENTAL;
  }

  return DmmCategory.OTHER;
};

export const parseMonoLikeDetail = ($: CheerioAPI): Partial<CrawlerData> | null => {
  const title = extractText($, "h1#title") ?? extractText($, "h1.item.fn.bold") ?? extractText($, "h1 span");
  if (!title) {
    return null;
  }

  const release =
    parseDate(
      extractText($, "td:contains('発売日') + td") ??
        extractText($, "th:contains('発売日') + td") ??
        extractText($, "td:contains('配信開始日') + td") ??
        extractText($, "th:contains('配信開始日') + td"),
    ) ?? undefined;

  const studio = extractText($, "td:contains('メーカー') + td a") ?? extractText($, "th:contains('メーカー') + td a");
  const publisher =
    extractText($, "td:contains('レーベル') + td a") ?? extractText($, "th:contains('レーベル') + td a") ?? studio;
  const series = extractText($, "td:contains('シリーズ') + td a") ?? extractText($, "th:contains('シリーズ') + td a");
  const directors = uniqueStrings([
    ...extractList($, "td:contains('監督') + td a"),
    ...extractList($, "th:contains('監督') + td a"),
  ]);

  const actors = uniqueStrings([
    ...extractList($, "#performer a"),
    ...extractList($, "#fn-visibleActor a"),
    ...extractList($, "td:contains('出演者') + td a"),
    ...extractList($, "th:contains('出演者') + td a"),
  ]);

  const genres = uniqueStrings([
    ...extractList($, "td:contains('ジャンル') + td a"),
    ...extractList($, "th:contains('ジャンル') + td a"),
  ]);

  const thumb =
    extractAttr($, "meta[property='og:image']", "content") ?? extractAttr($, "a[name='package-image'] img", "src");
  const thumbUrl = thumb?.replace("ps.jpg", "pl.jpg");

  const sampleImages = uniqueStrings(
    [
      ...$("#sample-image-block a")
        .toArray()
        .map((element: CheerioInput) => $(element).attr("href")),
      ...$("a[name='sample-image'] img")
        .toArray()
        .map((element: CheerioInput) => $(element).attr("data-lazy") ?? $(element).attr("src")),
    ].map((url) => normalizeDmmSampleImageUrl(url)),
  );

  const plot =
    extractText($, ".wrapper-detailContents ~ div p.mg-b20") ??
    extractText($, ".clear p") ??
    extractText($, "meta[name='description']");

  const ratingText = extractText($, "p.d-review__average strong");
  const rating = ratingText ? Number.parseFloat(ratingText.replace("点", "")) : undefined;

  return {
    title,
    actors,
    genres,
    studio,
    director: directors[0],
    publisher,
    series,
    plot,
    release_date: release,
    rating: Number.isFinite(rating) ? rating : undefined,
    thumb_url: thumbUrl,
    poster_url: thumbUrl?.replace("pl.jpg", "ps.jpg"),
    sample_images: sampleImages,
  };
};

export const parseDigitalDetail = ($: CheerioAPI): Partial<CrawlerData> | null => {
  const base = parseMonoLikeDetail($);
  const jsonLd = readFirstJsonLdRecord($) as DmmJsonLd | null;

  if (!base && !jsonLd) {
    return null;
  }

  const images = jsonLd?.image ?? [];
  const actorsFromJson = uniqueStrings((jsonLd?.subjectOf?.actor ?? []).map((actor) => actor.name));
  const genresFromJson = uniqueStrings(jsonLd?.subjectOf?.genre ?? []);
  const releaseFromJson = parseDate(jsonLd?.subjectOf?.uploadDate) ?? undefined;
  const trailerFromJson = jsonLd?.subjectOf?.contentUrl;
  const ratingFromJson = jsonLd?.aggregateRating?.ratingValue;

  const thumbFromJson = images[0];
  const thumbUrl = thumbFromJson ?? base?.thumb_url;

  // Merge sample images from JSON-LD (skip first image = thumb) and HTML sources
  const jsonLdSamples = images.length > 1 ? images.slice(1) : [];
  const htmlSamples = base?.sample_images ?? [];
  const mergedSamples = uniqueStrings([...jsonLdSamples, ...htmlSamples]);

  return {
    ...base,
    title: jsonLd?.name ?? base?.title,
    plot: jsonLd?.description ?? base?.plot,
    actors: actorsFromJson.length > 0 ? actorsFromJson : base?.actors,
    genres: genresFromJson.length > 0 ? genresFromJson : base?.genres,
    studio: jsonLd?.brand?.name ?? base?.studio,
    release_date: releaseFromJson ?? base?.release_date,
    rating: Number.isFinite(ratingFromJson) ? ratingFromJson : base?.rating,
    thumb_url: thumbUrl,
    poster_url: thumbUrl?.replace("pl.jpg", "ps.jpg") ?? base?.poster_url,
    sample_images: mergedSamples.length > 0 ? mergedSamples : base?.sample_images,
    trailer_url: trailerFromJson ?? base?.trailer_url,
  };
};
