import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import type { ActorProfile } from "@mdcz/shared/types";
import { normalizeText } from "./normalization";

const PROFILE_SECTION_TITLE = "基本资料";
const ALIASES_PREFIX = "别名：";
const PROFILE_FIELD_PREFIXES = ["生日：", "出生地：", "血型：", "身高：", "三围：", "罩杯："] as const;

const normalizeOverview = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return normalized || undefined;
};

const buildAliasesLine = (profile: Pick<ActorProfile, "name" | "aliases">): string | undefined => {
  const aliases = toUniqueActorNames(profile.aliases ?? [], (value) => normalizeText(value) || undefined).filter(
    (alias) => normalizeActorName(alias) !== normalizeActorName(profile.name),
  );

  return aliases.length > 0 ? `${ALIASES_PREFIX}${aliases.join(" / ")}` : undefined;
};

const buildMeasurementsLine = (profile: Pick<ActorProfile, "bust_cm" | "waist_cm" | "hip_cm">): string | undefined => {
  const parts = [
    profile.bust_cm !== undefined ? `B${profile.bust_cm}` : undefined,
    profile.waist_cm !== undefined ? `W${profile.waist_cm}` : undefined,
    profile.hip_cm !== undefined ? `H${profile.hip_cm}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return parts.length > 0 ? `三围：${parts.join(" ")}` : undefined;
};

const buildProfileSummaryBlock = (
  profile: Pick<
    ActorProfile,
    "birth_date" | "birth_place" | "blood_type" | "height_cm" | "bust_cm" | "waist_cm" | "hip_cm" | "cup_size"
  >,
): string | undefined => {
  const lines = [
    profile.blood_type ? `血型：${profile.blood_type}型` : undefined,
    profile.height_cm !== undefined ? `身高：${profile.height_cm}cm` : undefined,
    buildMeasurementsLine(profile),
    profile.cup_size ? `罩杯：${profile.cup_size}杯` : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return lines.length > 0 ? `${PROFILE_SECTION_TITLE}\n${lines.join("\n")}` : undefined;
};

const isManagedProfileLine = (line: string): boolean => {
  return PROFILE_FIELD_PREFIXES.some((prefix) => line.startsWith(prefix));
};

const stripManagedProfileBlock = (overview: string | undefined): string | undefined => {
  if (!overview) {
    return undefined;
  }

  const lines = overview.split("\n");
  let cursor = 0;
  while (cursor < lines.length && lines[cursor] === "") {
    cursor += 1;
  }

  if (lines[cursor] !== PROFILE_SECTION_TITLE) {
    return overview;
  }

  cursor += 1;
  let detailCount = 0;
  while (cursor < lines.length && lines[cursor] !== "") {
    if (!isManagedProfileLine(lines[cursor] ?? "")) {
      return overview;
    }
    detailCount += 1;
    cursor += 1;
  }

  if (detailCount === 0) {
    return overview;
  }

  while (cursor < lines.length && lines[cursor] === "") {
    cursor += 1;
  }

  const strippedOverview = lines.slice(cursor).join("\n").trim();
  return strippedOverview || undefined;
};

export const stripManagedPersonOverview = (overview: string | undefined): string | undefined => {
  const normalizedOverview = stripManagedProfileBlock(normalizeOverview(overview));
  if (!normalizedOverview) {
    return undefined;
  }

  const lines = normalizedOverview.split("\n");
  let endIndex = lines.length;
  while (endIndex > 0 && lines[endIndex - 1] === "") {
    endIndex--;
  }

  if (endIndex === 0 || !lines[endIndex - 1]?.startsWith(ALIASES_PREFIX)) {
    return normalizedOverview;
  }

  endIndex--;
  while (endIndex > 0 && lines[endIndex - 1] === "") {
    endIndex--;
  }

  const strippedOverview = lines.slice(0, endIndex).join("\n").trim();
  return strippedOverview || undefined;
};

export const buildPersonOverview = (
  overview: string | undefined,
  profile: Pick<
    ActorProfile,
    | "name"
    | "aliases"
    | "birth_date"
    | "birth_place"
    | "blood_type"
    | "height_cm"
    | "bust_cm"
    | "waist_cm"
    | "hip_cm"
    | "cup_size"
  >,
): string | undefined => {
  const normalizedOverview = normalizeOverview(overview);
  const profileSummary = buildProfileSummaryBlock(profile);
  const aliasesLine = buildAliasesLine(profile);

  const sections = [profileSummary, normalizedOverview, aliasesLine].filter((entry): entry is string => Boolean(entry));
  return sections.length > 0 ? sections.join("\n\n") : undefined;
};
