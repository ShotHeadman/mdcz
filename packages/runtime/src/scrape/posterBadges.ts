import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Configuration } from "@mdcz/shared/config";
import { POSTER_TAG_BADGE_TYPE_OPTIONS, type PosterTagBadgeType } from "@mdcz/shared/posterBadges";
import type { CrawlerData, FileInfo, NfoLocalState, PosterRebuild, PosterRecord } from "@mdcz/shared/types";
import sharp from "sharp";
import { buildMovieTags, normalizeNfoLocalState } from "../maintenance/movieTags";
import type { ImageDimensions } from "./utils/image";
import { classifyMovie, type MovieClassification } from "./utils/movieClassification";

export interface PosterBadgeDefinition {
  id: PosterTagBadgeType;
  label: string;
  colorStart: string;
  colorEnd: string;
  accentColor: string;
}

interface PosterBadgeMatchContext {
  classification: MovieClassification | undefined;
  fileInfo: FileInfo | undefined;
  tags: ReadonlySet<string>;
}
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
    matches: ({ tags }) => ["中文字幕", "字幕", "中字"].some((candidate) => tags.has(candidate)),
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

const toBadgeDefinition = ({ matches: _matches, ...definition }: (typeof POSTER_BADGE_DEFINITIONS)[number]) =>
  definition;

export const listPosterBadgeDefinitions = (types: readonly PosterTagBadgeType[]): PosterBadgeDefinition[] =>
  POSTER_BADGE_DEFINITIONS.filter(({ id }) => types.includes(id)).map(toBadgeDefinition);

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
  ).map(toBadgeDefinition);
};

/** The badges a poster should carry now, and a stamp of everything that decides how they look. */
export const resolvePosterBadgeStamp = (
  data: CrawlerData,
  fileInfo: FileInfo | undefined,
  localState: NfoLocalState | undefined,
  download: Configuration["download"],
): { badges: PosterBadgeDefinition[]; stamp: string } => {
  const badges = download.tagBadges
    ? resolvePosterBadgeDefinitions(data, fileInfo, localState, download.tagBadgeTypes)
    : [];
  const stamp = badges.length
    ? [
        badges.map((badge) => badge.id).join(","),
        download.tagBadgePosition,
        download.tagBadgeSizePercent,
        download.tagBadgeOpacity,
        download.tagBadgeInsetPercent,
        download.tagBadgeImageOverrides ? "images" : "drawn",
      ].join("|")
    : "";
  return { badges, stamp };
};

export const hashPosterFile = async (posterPath: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(posterPath))
    .digest("hex");

/**
 * What a write does with a poster whose badges are out of date. MDCz rebuilds only a poster it can tell is its own: the
 * file still has the hash it was written with, or it has no record and its rebuild comes out at exactly its size, which
 * holds for a poster MDCz made because MDCz never resizes one. A poster with no record that shouldn't carry badges is
 * left alone, since nothing says whether it carries any.
 */
export const decidePosterRebuild = async (
  posterPath: string,
  record: PosterRecord | undefined,
  stamp: string,
  rebuildSize: () => Promise<ImageDimensions | undefined>,
): Promise<PosterRebuild | undefined> => {
  if (record ? record.stamp === stamp : stamp === "") return undefined;
  if (record) return (await hashPosterFile(posterPath)) === record.sha256 ? "redraw" : "kept";
  const [current, rebuilt] = await Promise.all([sharp(posterPath).metadata(), rebuildSize()]);
  return rebuilt && rebuilt.width === current.width && rebuilt.height === current.height ? "redraw" : "kept";
};
