import { normalizeActorName, toUniqueActorNames } from "@mdcz/shared/actorAliases";
import type { ActorProfile } from "@mdcz/shared/types";
import { normalizeText } from "./utils";

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

const toTrimmedString = (value: string | undefined): string | undefined => {
  const normalized = normalizeText(value);
  return normalized || undefined;
};

const pad = (value: number): string => String(value).padStart(2, "0");

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
