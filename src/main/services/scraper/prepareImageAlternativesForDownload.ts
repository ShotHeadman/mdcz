import { buildDmmAwsImageCandidates } from "@main/utils/dmmImage";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { ImageAlternatives, SourceMap } from "./aggregation";

const normalizeUrl = (input?: string): string | null => {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return null;
};

const cloneSampleImageAlternatives = (sets: ImageAlternatives["sample_images"] | undefined): string[][] =>
  (sets ?? []).map((urls) => [...urls]);

const cloneSampleImageAlternativeSources = (
  sources: ImageAlternatives["sample_image_sources"] | undefined,
): Website[] => [...(sources ?? [])];

const expandDmmPrimaryImageAlternatives = (
  primaryUrl: string | undefined,
  alternatives: string[] | undefined,
  rawNumber: string,
): string[] => {
  const seen = new Set<string>();
  const expanded: string[] = [];

  const append = (value?: string | null): void => {
    const normalized = normalizeUrl(value ?? undefined);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    expanded.push(normalized);
  };

  const normalizedPrimary = normalizeUrl(primaryUrl);
  if (normalizedPrimary) {
    seen.add(normalizedPrimary);
    for (const candidate of buildDmmAwsImageCandidates(normalizedPrimary, rawNumber)) {
      append(candidate);
    }
  }

  for (const alternative of alternatives ?? []) {
    const normalized = normalizeUrl(alternative);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    expanded.push(normalized);
    for (const candidate of buildDmmAwsImageCandidates(normalized, rawNumber)) {
      append(candidate);
    }
  }

  return expanded;
};

const isDmmPrimaryImageSource = (
  field: "thumb_url" | "poster_url",
  data: Pick<CrawlerData, "website">,
  sources: Pick<SourceMap, "thumb_url" | "poster_url"> | undefined,
): boolean => {
  return sources?.[field] === Website.DMM || data.website === Website.DMM;
};

export const prepareImageAlternativesForDownload = (
  data: Pick<CrawlerData, "number" | "website" | "thumb_url" | "poster_url">,
  imageAlternatives: Partial<ImageAlternatives> = {},
  sources?: Pick<SourceMap, "thumb_url" | "poster_url" | "sample_images">,
): Partial<ImageAlternatives> => {
  const prepared: Partial<ImageAlternatives> = {
    thumb_url: [...(imageAlternatives.thumb_url ?? [])],
    poster_url: [...(imageAlternatives.poster_url ?? [])],
    sample_images: cloneSampleImageAlternatives(imageAlternatives.sample_images),
    sample_images_source: imageAlternatives.sample_images_source ?? sources?.sample_images,
    sample_image_sources: cloneSampleImageAlternativeSources(imageAlternatives.sample_image_sources),
  };

  return {
    ...prepared,
    thumb_url: isDmmPrimaryImageSource("thumb_url", data, sources)
      ? expandDmmPrimaryImageAlternatives(data.thumb_url, imageAlternatives.thumb_url, data.number)
      : prepared.thumb_url,
    poster_url: isDmmPrimaryImageSource("poster_url", data, sources)
      ? expandDmmPrimaryImageAlternatives(data.poster_url, imageAlternatives.poster_url, data.number)
      : prepared.poster_url,
  };
};
