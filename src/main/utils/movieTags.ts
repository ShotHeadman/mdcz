import { classifyMovie } from "@main/utils/movieClassification";
import { buildManagedMovieTags } from "@main/utils/movieMetadata";
import { normalizeNfoLocalState, uncensoredChoiceToTag } from "@main/utils/nfoLocalState";
import { resolveFileInfoSubtitleTag } from "@main/utils/subtitles";
import { POSTER_TAG_BADGE_TYPE_OPTIONS, type PosterTagBadgeType } from "@shared/posterBadges";
import type { CrawlerData, FileInfo, NfoLocalState } from "@shared/types";

export interface PosterBadgeDefinition {
  id: PosterTagBadgeType;
  label: string;
  colorStart: string;
  colorEnd: string;
  accentColor: string;
}

interface PosterBadgeMatchContext {
  classification: ReturnType<typeof classifyMovie> | undefined;
  fileInfo: FileInfo | undefined;
  tags: ReadonlySet<string>;
}

const hasAnyTag = (tags: ReadonlySet<string>, candidates: readonly string[]): boolean =>
  candidates.some((candidate) => tags.has(candidate));

const matchesResolution = (fileInfo: FileInfo | undefined, candidates: readonly string[]): boolean => {
  const resolution = fileInfo?.resolution?.trim().toUpperCase();
  if (!resolution) {
    return false;
  }

  return candidates.includes(resolution);
};

const POSTER_BADGE_DEFINITIONS: Array<
  PosterBadgeDefinition & { matches: (context: PosterBadgeMatchContext) => boolean }
> = [
  {
    id: "subtitle",
    label: "中字",
    colorStart: "#F04A3A",
    colorEnd: "#B91C1C",
    accentColor: "#FFD5D0",
    matches: ({ tags }) => hasAnyTag(tags, ["中文字幕", "字幕", "中字"]),
  },
  {
    id: "censored",
    label: "有码",
    colorStart: "#0F766E",
    colorEnd: "#115E59",
    accentColor: "#CCFBF1",
    matches: ({ classification, fileInfo }) =>
      fileInfo !== undefined &&
      classification !== undefined &&
      !classification.uncensored &&
      !classification.umr &&
      !classification.leak,
  },
  {
    id: "umr",
    label: "破解",
    colorStart: "#E77A0C",
    colorEnd: "#B45309",
    accentColor: "#FDE5C2",
    matches: ({ tags }) => tags.has("破解"),
  },
  {
    id: "leak",
    label: "流出",
    colorStart: "#2B6CB0",
    colorEnd: "#1E3A5F",
    accentColor: "#D6E8FF",
    matches: ({ tags }) => tags.has("流出"),
  },
  {
    id: "uncensored",
    label: "无码",
    colorStart: "#505B67",
    colorEnd: "#1F2937",
    accentColor: "#E5E7EB",
    matches: ({ tags }) => tags.has("无码"),
  },
  {
    id: "fullHd",
    label: "1080P",
    colorStart: "#6D28D9",
    colorEnd: "#5B21B6",
    accentColor: "#E9D5FF",
    matches: ({ fileInfo }) => matchesResolution(fileInfo, ["1080P"]),
  },
  {
    id: "fourK",
    label: "4K",
    colorStart: "#166534",
    colorEnd: "#14532D",
    accentColor: "#DCFCE7",
    matches: ({ fileInfo }) => matchesResolution(fileInfo, ["4K", "2160P"]),
  },
  {
    id: "eightK",
    label: "8K",
    colorStart: "#7C2D12",
    colorEnd: "#9A3412",
    accentColor: "#FFEDD5",
    matches: ({ fileInfo }) => matchesResolution(fileInfo, ["8K"]),
  },
];

export const buildMovieTags = (
  data: CrawlerData,
  fileInfo: FileInfo | undefined,
  localState: NfoLocalState | undefined,
): string[] => {
  const classificationTags: string[] = [];
  const normalizedLocalState = normalizeNfoLocalState(localState);
  const localChoiceTag = uncensoredChoiceToTag(normalizedLocalState?.uncensoredChoice);
  if (localChoiceTag) {
    classificationTags.push(localChoiceTag);
  }

  if (fileInfo) {
    if (!localChoiceTag) {
      const classification = classifyMovie(fileInfo, data, normalizedLocalState);
      if (classification.umr) {
        classificationTags.push("破解");
      } else if (classification.leak) {
        classificationTags.push("流出");
      } else if (classification.uncensored) {
        classificationTags.push("无码");
      }
    }

    const subtitleTag = resolveFileInfoSubtitleTag(fileInfo);
    if (subtitleTag) {
      classificationTags.push(subtitleTag);
    }
  }

  return Array.from(
    new Set([
      ...classificationTags,
      ...(normalizedLocalState?.tags ?? []),
      ...buildManagedMovieTags({
        contentType: data.content_type,
      }),
    ]),
  );
};

export const resolvePosterBadgeDefinitions = (
  data: CrawlerData,
  fileInfo: FileInfo | undefined,
  localState: NfoLocalState | undefined,
  enabledTypes: readonly PosterTagBadgeType[] = POSTER_TAG_BADGE_TYPE_OPTIONS,
): PosterBadgeDefinition[] => {
  const tags = new Set(buildMovieTags(data, fileInfo, localState));
  const enabledTypeSet = new Set(enabledTypes);
  const normalizedLocalState = normalizeNfoLocalState(localState);
  const classification = fileInfo ? classifyMovie(fileInfo, data, normalizedLocalState) : undefined;

  return POSTER_BADGE_DEFINITIONS.filter(
    (definition) => enabledTypeSet.has(definition.id) && definition.matches({ tags, fileInfo, classification }),
  ).map(({ matches: _matches, ...definition }) => definition);
};
