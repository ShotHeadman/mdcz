import type { CrawlerData, FileInfo, NfoLocalState, UncensoredChoice } from "@mdcz/shared/types";
import { classifyMovie } from "../scrape/utils/movieClassification";
import { resolveFileInfoSubtitleTag } from "../scrape/utils/subtitles";

const MANAGED_MOVIE_TAG_PREFIX = "mdcz:";
const UNCENSORED_CHOICE_TAGS: Record<UncensoredChoice, string> = {
  leak: "流出",
  uncensored: "无码",
  umr: "破解",
};
const UNCENSORED_TAG_CHOICES = new Map(
  Object.entries(UNCENSORED_CHOICE_TAGS).map(([choice, tag]) => [tag, choice as UncensoredChoice]),
);

export const uncensoredChoiceToTag = (choice: UncensoredChoice | undefined): string | undefined =>
  choice ? UNCENSORED_CHOICE_TAGS[choice] : undefined;

export const tagToUncensoredChoice = (tag: string): UncensoredChoice | undefined =>
  UNCENSORED_TAG_CHOICES.get(tag.trim());

export const normalizeNfoLocalState = (localState: NfoLocalState | undefined): NfoLocalState | undefined => {
  if (!localState) return undefined;
  const tags = Array.from(
    new Set((localState.tags ?? []).map((value) => value.trim()).filter((value) => value.length > 0)),
  );
  if (!localState.uncensoredChoice && tags.length === 0) return undefined;
  return {
    uncensoredChoice: localState.uncensoredChoice,
    tags: tags.length > 0 ? tags : undefined,
  };
};

const normalizeText = (value: string | undefined | null): string => value?.trim().replace(/\s+/gu, " ") ?? "";

const buildManagedMovieTag = (key: "content_type", value: string | undefined): string | undefined => {
  const normalized = normalizeText(value);
  return normalized ? `${MANAGED_MOVIE_TAG_PREFIX}${key}:${normalized}` : undefined;
};

const parseManagedMovieTag = (tag: string): { key: "content_type"; value: string } | null => {
  if (!tag.startsWith(MANAGED_MOVIE_TAG_PREFIX)) return null;
  const payload = tag.slice(MANAGED_MOVIE_TAG_PREFIX.length);
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex <= 0) return null;
  const key = payload.slice(0, separatorIndex);
  const value = normalizeText(payload.slice(separatorIndex + 1));
  return key === "content_type" && value ? { key, value } : null;
};

export const isManagedMovieTag = (tag: string): boolean => parseManagedMovieTag(tag) !== null;

export const buildManagedMovieTags = (input: { contentType?: string }): string[] =>
  [buildManagedMovieTag("content_type", input.contentType)].filter((entry): entry is string => Boolean(entry));

export const parseManagedMovieTags = (tags: string[]): { content_type?: string } => {
  const parsed: { content_type?: string } = {};
  for (const tag of tags) {
    const entry = parseManagedMovieTag(tag);
    if (entry?.key === "content_type") parsed.content_type ??= entry.value;
  }
  return parsed;
};

export const buildMovieTags = (
  data: CrawlerData,
  fileInfo: FileInfo | undefined,
  localState: NfoLocalState | undefined,
): string[] => {
  const classificationTags: string[] = [];
  const normalizedLocalState = normalizeNfoLocalState(localState);
  const localChoiceTag = uncensoredChoiceToTag(normalizedLocalState?.uncensoredChoice);
  if (localChoiceTag) classificationTags.push(localChoiceTag);

  if (fileInfo) {
    if (!localChoiceTag) {
      const classification = classifyMovie(fileInfo, data, normalizedLocalState);
      if (classification.umr) classificationTags.push("破解");
      else if (classification.leak) classificationTags.push("流出");
      else if (classification.uncensored) classificationTags.push("无码");
    }
    const subtitleTag = resolveFileInfoSubtitleTag(fileInfo);
    if (subtitleTag) classificationTags.push(subtitleTag);
  }

  return Array.from(
    new Set([
      ...classificationTags,
      ...(normalizedLocalState?.tags ?? []),
      ...buildManagedMovieTags({ contentType: data.content_type }),
    ]),
  );
};
