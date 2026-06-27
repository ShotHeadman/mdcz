import { normalizeText, uniqueStrings } from "@mdcz/runtime/shared";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";

import { extractAttr, extractList, extractText, parseDate } from "../../base/parser";
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
const DMM_SCENE_IMAGE_PATTERN = /jp-\d+\.(?:jpe?g|png|webp)$/iu;
const DMM_PRIMARY_IMAGE_PATTERN = /p[sl]\.(?:jpe?g|png|webp)$/iu;
const DMM_NOISE_GENRES = new Set(["サンプル動画"]);
const DMM_DUMMY_IMAGE_PATTERN = /\/(?:dummy|loading)[^/]*\.(?:gif|png|jpe?g|webp)$/iu;

const normalizeDmmLabelText = (value: string): string => normalizeText(value).replace(/[：:]\s*$/u, "");

const findDmmLabelCells = ($: CheerioAPI, labels: readonly string[]) => {
  const labelSet = new Set(labels);
  return $("tr > th, tr > td").filter((_index: number, element: CheerioInput) => {
    const cell = $(element).clone();
    cell.find("script, style, noscript").remove();
    return cell.children("a").length === 0 && labelSet.has(normalizeDmmLabelText(cell.text()));
  });
};

const extractDmmTableValue = ($: CheerioAPI, labels: readonly string[]): string | undefined => {
  return findDmmLabelCells($, labels)
    .toArray()
    .map((element: CheerioInput) => {
      const valueCell = $(element).next("td").first().clone();
      valueCell.find("script, style, noscript").remove();
      return normalizeText(valueCell.text());
    })
    .find((text) => text.length > 0);
};

const extractDmmTableLinks = ($: CheerioAPI, labels: readonly string[]): string[] => {
  return uniqueStrings(
    findDmmLabelCells($, labels)
      .toArray()
      .flatMap((element: CheerioInput) =>
        $(element)
          .next("td")
          .find("a")
          .toArray()
          .map((link: CheerioInput) => $(link).text().trim())
          .filter((text) => text.length > 0),
      ),
  );
};

const extractRelatedTags = ($: CheerioAPI): string[] => {
  const texts = [...extractDmmTableLinks($, ["関連タグ"])];

  return uniqueStrings(
    texts.flatMap((text) => {
      const normalized = text.replace(/\u3000/gu, " ").trim();
      if (!normalized) {
        return [];
      }

      const rawParts = normalized.includes("#") ? normalized.split(/\s+/u) : [normalized];
      return rawParts.map((part) => part.replace(/^#+/u, "").trim()).filter((part) => part.length > 0);
    }),
  );
};

const normalizeDmmGenres = (values: Array<string | undefined>): string[] =>
  uniqueStrings(values).filter((value) => !DMM_NOISE_GENRES.has(value));

const normalizeDmmSceneImageUrl = (value: string | undefined): string | undefined => {
  if (!value || DMM_PRIMARY_IMAGE_PATTERN.test(value)) {
    return undefined;
  }

  if (DMM_SCENE_IMAGE_PATTERN.test(value)) {
    return value;
  }

  const normalized = value.replace(/-(\d+)\.(jpe?g|png|webp)$/iu, "jp-$1.$2");
  return DMM_SCENE_IMAGE_PATTERN.test(normalized) ? normalized : undefined;
};

const extractSrcsetFirstUrl = (value: string | undefined): string | undefined => {
  const first = value?.split(",")[0]?.trim().split(/\s+/u)[0]?.trim();
  return first && first.length > 0 ? first : undefined;
};

const isUsableDmmImageUrl = (value: string | undefined): value is string => {
  if (!value || DMM_DUMMY_IMAGE_PATTERN.test(value)) {
    return false;
  }

  return /\.(?:jpe?g|png|webp)(?:[?#].*)?$/iu.test(value);
};

const extractDmmPrimaryImage = ($: CheerioAPI): string | undefined => {
  const candidates = [
    extractAttr($, "meta[property='og:image']", "content"),
    extractAttr($, "meta[name='twitter:image']", "content"),
    extractAttr($, "img[name='package-image']", "src"),
    extractAttr($, "img[name='package-image']", "data-lazy"),
    extractSrcsetFirstUrl(extractAttr($, "img[name='package-image']", "srcset")),
    extractAttr($, "a[name='package-image'] img", "data-lazy"),
    extractAttr($, "a[name='package-image'] img", "src"),
    extractSrcsetFirstUrl(extractAttr($, "a[name='package-image'] img", "srcset")),
    extractAttr($, "a[name='package-image']", "href"),
  ];

  return candidates.find(isUsableDmmImageUrl);
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
    parseDate(extractDmmTableValue($, ["発売日"]) ?? extractDmmTableValue($, ["配信開始日"])) ?? undefined;

  const studio = extractDmmTableLinks($, ["メーカー"])[0];
  const publisher = extractDmmTableLinks($, ["レーベル"])[0] ?? studio;
  const series = extractDmmTableLinks($, ["シリーズ"])[0];
  const directors = extractDmmTableLinks($, ["監督"]);

  const actors = uniqueStrings([
    ...extractList($, "#performer a"),
    ...extractList($, "#fn-visibleActor a"),
    ...extractDmmTableLinks($, ["出演者"]),
  ]);

  const genres = normalizeDmmGenres([...extractDmmTableLinks($, ["ジャンル"]), ...extractRelatedTags($)]);

  const thumb = extractDmmPrimaryImage($);
  const thumbUrl = thumb?.replace("ps.jpg", "pl.jpg");

  const sceneImages = uniqueStrings(
    [
      ...$("#sample-image-block a")
        .toArray()
        .map((element: CheerioInput) => $(element).attr("href")),
      ...$("a[name='sample-image'] img")
        .toArray()
        .map((element: CheerioInput) => $(element).attr("data-lazy") ?? $(element).attr("src")),
    ].map((url) => normalizeDmmSceneImageUrl(url)),
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
    scene_images: sceneImages,
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
  const genresFromJson = normalizeDmmGenres(jsonLd?.subjectOf?.genre ?? []);
  const releaseFromJson = parseDate(jsonLd?.subjectOf?.uploadDate) ?? undefined;
  const trailerFromJson = jsonLd?.subjectOf?.contentUrl;
  const ratingFromJson = jsonLd?.aggregateRating?.ratingValue;

  const thumbFromJson = images[0];
  const thumbUrl = thumbFromJson ?? base?.thumb_url;

  // Merge scene images from JSON-LD (skip first image = thumb) and HTML sources
  const jsonLdSamples = images.length > 1 ? images.slice(1) : [];
  const htmlSamples = base?.scene_images ?? [];
  const mergedSamples = uniqueStrings([...jsonLdSamples, ...htmlSamples]);

  return {
    ...base,
    title: jsonLd?.name ?? base?.title,
    plot: jsonLd?.description ?? base?.plot,
    actors: actorsFromJson.length > 0 ? actorsFromJson : base?.actors,
    genres: normalizeDmmGenres([...(base?.genres ?? []), ...genresFromJson]),
    studio: jsonLd?.brand?.name ?? base?.studio,
    release_date: releaseFromJson ?? base?.release_date,
    rating: Number.isFinite(ratingFromJson) ? ratingFromJson : base?.rating,
    thumb_url: thumbUrl,
    poster_url: thumbUrl?.replace("pl.jpg", "ps.jpg") ?? base?.poster_url,
    scene_images: mergedSamples.length > 0 ? mergedSamples : base?.scene_images,
    trailer_url: trailerFromJson ?? base?.trailer_url,
  };
};
