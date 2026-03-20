import { buildDmmAwsImageCandidates, isDmmImageUrl } from "@main/utils/dmmImage";
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

const cloneSceneImageAlternatives = (sets: ImageAlternatives["scene_images"] | undefined): string[][] =>
  (sets ?? []).map((urls) => [...urls]);

const cloneSceneImageAlternativeSources = (
  sources: ImageAlternatives["scene_image_sources"] | undefined,
): NonNullable<ImageAlternatives["scene_image_sources"]> => [...(sources ?? [])];

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

const hasDmmPrimaryImageUrl = (
  field: "thumb_url" | "poster_url",
  data: Pick<CrawlerData, "thumb_url" | "poster_url">,
  _sources: Pick<SourceMap, "thumb_url" | "poster_url"> | undefined,
): boolean => {
  return isDmmImageUrl(data[field]);
};

export const prepareImageAlternativesForDownload = (
  data: Pick<CrawlerData, "number" | "thumb_url" | "poster_url">,
  imageAlternatives: Partial<ImageAlternatives> = {},
  sources?: Pick<SourceMap, "thumb_url" | "poster_url" | "scene_images">,
): Partial<ImageAlternatives> => {
  const prepared: Partial<ImageAlternatives> = {
    thumb_url: [...(imageAlternatives.thumb_url ?? [])],
    poster_url: [...(imageAlternatives.poster_url ?? [])],
    scene_images: cloneSceneImageAlternatives(imageAlternatives.scene_images),
    scene_images_source: imageAlternatives.scene_images_source ?? sources?.scene_images,
    scene_image_sources: cloneSceneImageAlternativeSources(imageAlternatives.scene_image_sources),
  };

  return {
    ...prepared,
    thumb_url: hasDmmPrimaryImageUrl("thumb_url", data, sources)
      ? expandDmmPrimaryImageAlternatives(data.thumb_url, imageAlternatives.thumb_url, data.number)
      : prepared.thumb_url,
    poster_url: hasDmmPrimaryImageUrl("poster_url", data, sources)
      ? expandDmmPrimaryImageAlternatives(data.poster_url, imageAlternatives.poster_url, data.number)
      : prepared.poster_url,
  };
};
