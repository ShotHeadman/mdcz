import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import { normalizeText } from "@main/utils/normalization";
import type { ActorProfile } from "@shared/types";

export const ACTOR_PROFILE_METADATA_FIELDS = [
  "description",
  "photo_url",
  "birth_date",
  "birth_place",
  "blood_type",
  "height_cm",
  "bust_cm",
  "waist_cm",
  "hip_cm",
  "cup_size",
] as const;

export type ActorProfileMetadataField = (typeof ACTOR_PROFILE_METADATA_FIELDS)[number];

const MANAGED_TAG_PREFIX = "mdcz:";
const MANAGED_TAGLINE_PREFIX = "MDCz: ";

const ACTOR_MANAGED_TAG_KEYS = [
  "birth_date",
  "birth_place",
  "blood_type",
  "height_cm",
  "bust_cm",
  "waist_cm",
  "hip_cm",
  "cup_size",
] as const;

type ActorManagedTagKey = (typeof ACTOR_MANAGED_TAG_KEYS)[number];

const toTrimmedString = (value: string | undefined): string | undefined => {
  const normalized = normalizeText(value);
  return normalized || undefined;
};

const pad = (value: number): string => String(value).padStart(2, "0");

const parseActorManagedTag = (tag: string): { key: ActorManagedTagKey; value: string } | null => {
  if (!tag.startsWith(MANAGED_TAG_PREFIX)) {
    return null;
  }

  const payload = tag.slice(MANAGED_TAG_PREFIX.length);
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = payload.slice(0, separatorIndex);
  const value = payload.slice(separatorIndex + 1).trim();
  if (!ACTOR_MANAGED_TAG_KEYS.includes(key as ActorManagedTagKey) || value.length === 0) {
    return null;
  }

  return {
    key: key as ActorManagedTagKey,
    value,
  };
};

export const hasActorProfileFieldValue = (value: unknown): boolean => {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return false;
};

export const hasActorProfileContent = (profile: ActorProfile): boolean => {
  return Boolean(
    (profile.aliases?.length ?? 0) > 0 ||
      ACTOR_PROFILE_METADATA_FIELDS.some((field) => hasActorProfileFieldValue(profile[field])),
  );
};

export const mergeActorProfiles = (profiles: ActorProfile[]): ActorProfile | null => {
  const validProfiles = profiles.filter((profile) => toTrimmedString(profile.name));
  if (validProfiles.length === 0) {
    return null;
  }

  const name = toTrimmedString(validProfiles[0]?.name) ?? "";
  const aliases = toUniqueActorNames(
    validProfiles.flatMap((profile) => profile.aliases ?? []),
    toTrimmedString,
  ).filter((alias) => normalizeActorName(alias) !== normalizeActorName(name));

  const merged: ActorProfile = {
    name,
    aliases: aliases.length > 0 ? aliases : undefined,
  };

  for (const field of ACTOR_PROFILE_METADATA_FIELDS) {
    const value = validProfiles.map((profile) => profile[field]).find((entry) => hasActorProfileFieldValue(entry));
    if (!hasActorProfileFieldValue(value)) {
      continue;
    }

    Object.assign(merged, { [field]: typeof value === "string" ? value.trim() : value });
  }

  return merged;
};

export const parseActorDate = (value: string | undefined): string | undefined => {
  const normalized = value?.normalize("NFKC").trim();
  if (!normalized) {
    return undefined;
  }

  const matched = normalized.match(/(\d{4})[./\-年](\d{1,2})[./\-月](\d{1,2})/u);
  if (!matched) {
    return undefined;
  }

  const year = Number.parseInt(matched[1], 10);
  const month = Number.parseInt(matched[2], 10);
  const day = Number.parseInt(matched[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return undefined;
  }

  return `${year}-${pad(month)}-${pad(day)}`;
};

export const parseActorMetricCm = (value: string | undefined): number | undefined => {
  const normalized = value?.normalize("NFKC").trim();
  if (!normalized) {
    return undefined;
  }

  const matched = normalized.match(/(-?\d+(?:\.\d+)?)/u);
  if (!matched) {
    return undefined;
  }

  const parsed = Number.parseFloat(matched[1]);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
};

export const parseActorBloodType = (value: string | undefined): string | undefined => {
  const normalized = value?.normalize("NFKC").toUpperCase().trim();
  if (!normalized) {
    return undefined;
  }

  const matched = normalized.match(/(AB|A|B|O)/u);
  return matched?.[1];
};

export const parseActorCupSize = (value: string | undefined): string | undefined => {
  const normalized = value?.normalize("NFKC").toUpperCase().trim();
  if (!normalized) {
    return undefined;
  }

  const parenthetical = normalized.match(/\(([A-Z]{1,3})\s*(?:カップ|CUP)?\)/u);
  if (parenthetical?.[1]) {
    return parenthetical[1];
  }

  const explicit = normalized.match(/(?:^|[^A-Z])([A-Z]{1,3})\s*(?:カップ|CUP)(?:$|[^A-Z])/u);
  if (explicit?.[1]) {
    return explicit[1];
  }

  const bare = normalized.match(/^([A-Z]{1,3})$/u);
  return bare?.[1];
};

const parseLabeledMetric = (value: string, label: "B" | "W" | "H"): number | undefined => {
  const matched = value.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)`, "iu"));
  if (!matched) {
    return undefined;
  }

  const parsed = Number.parseFloat(matched[1]);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
};

export const parseActorMeasurements = (
  value: string | undefined,
): Pick<ActorProfile, "bust_cm" | "waist_cm" | "hip_cm" | "cup_size"> => {
  const normalized = value?.normalize("NFKC").trim();
  if (!normalized) {
    return {};
  }

  return {
    bust_cm: parseLabeledMetric(normalized, "B"),
    waist_cm: parseLabeledMetric(normalized, "W"),
    hip_cm: parseLabeledMetric(normalized, "H"),
    cup_size: parseActorCupSize(normalized),
  };
};

const formatBloodType = (value: string | undefined): string | undefined => {
  return value ? `${value}型` : undefined;
};

const formatMeasurements = (profile: ActorProfile): string | undefined => {
  const parts = [
    profile.bust_cm !== undefined ? `B${profile.bust_cm}` : undefined,
    profile.waist_cm !== undefined ? `W${profile.waist_cm}` : undefined,
    profile.hip_cm !== undefined ? `H${profile.hip_cm}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return parts.length > 0 ? parts.join(" ") : undefined;
};

export const isActorManagedTag = (tag: string): boolean => {
  return parseActorManagedTag(tag) !== null;
};

export const parseActorManagedTags = (tags: string[]): Partial<ActorProfile> => {
  const profile: Partial<ActorProfile> = {};

  for (const tag of tags) {
    const parsed = parseActorManagedTag(tag);
    if (!parsed) {
      continue;
    }

    switch (parsed.key) {
      case "birth_date":
        profile.birth_date = parseActorDate(parsed.value) ?? profile.birth_date;
        break;
      case "birth_place":
        profile.birth_place = toTrimmedString(parsed.value) ?? profile.birth_place;
        break;
      case "blood_type":
        profile.blood_type = parseActorBloodType(parsed.value) ?? profile.blood_type;
        break;
      case "height_cm":
        profile.height_cm = parseActorMetricCm(parsed.value) ?? profile.height_cm;
        break;
      case "bust_cm":
        profile.bust_cm = parseActorMetricCm(parsed.value) ?? profile.bust_cm;
        break;
      case "waist_cm":
        profile.waist_cm = parseActorMetricCm(parsed.value) ?? profile.waist_cm;
        break;
      case "hip_cm":
        profile.hip_cm = parseActorMetricCm(parsed.value) ?? profile.hip_cm;
        break;
      case "cup_size":
        profile.cup_size = parseActorCupSize(parsed.value) ?? profile.cup_size;
        break;
    }
  }

  return profile;
};

export const buildActorManagedTags = (profile: ActorProfile): string[] => {
  const tags = [
    profile.birth_date ? `${MANAGED_TAG_PREFIX}birth_date:${profile.birth_date}` : undefined,
    profile.birth_place ? `${MANAGED_TAG_PREFIX}birth_place:${profile.birth_place}` : undefined,
    profile.blood_type ? `${MANAGED_TAG_PREFIX}blood_type:${profile.blood_type}` : undefined,
    profile.height_cm !== undefined ? `${MANAGED_TAG_PREFIX}height_cm:${profile.height_cm}` : undefined,
    profile.bust_cm !== undefined ? `${MANAGED_TAG_PREFIX}bust_cm:${profile.bust_cm}` : undefined,
    profile.waist_cm !== undefined ? `${MANAGED_TAG_PREFIX}waist_cm:${profile.waist_cm}` : undefined,
    profile.hip_cm !== undefined ? `${MANAGED_TAG_PREFIX}hip_cm:${profile.hip_cm}` : undefined,
    profile.cup_size ? `${MANAGED_TAG_PREFIX}cup_size:${profile.cup_size}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return Array.from(new Set(tags));
};

export const buildActorManagedTagline = (profile: ActorProfile): string | undefined => {
  const parts = [
    profile.birth_date,
    profile.birth_place,
    formatBloodType(profile.blood_type),
    profile.height_cm !== undefined ? `${profile.height_cm}cm` : undefined,
    formatMeasurements(profile),
    profile.cup_size ? `${profile.cup_size}カップ` : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return parts.length > 0 ? `${MANAGED_TAGLINE_PREFIX}${parts.join(" / ")}` : undefined;
};

export const isActorManagedTagline = (tagline: string): boolean => {
  return tagline.startsWith(MANAGED_TAGLINE_PREFIX);
};
