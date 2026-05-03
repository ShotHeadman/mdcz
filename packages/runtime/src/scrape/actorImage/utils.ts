import type { ActorProfile } from "@mdcz/shared/types";

export const normalizeActorName = (value: string): string => {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
};

export const toTrimmedActorName = (value: string | undefined | null): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
};

export const toUniqueActorNames = (
  values: ReadonlyArray<string | undefined>,
  normalizeValue: (value: string | undefined) => string | undefined = toTrimmedActorName,
): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalizedValue = normalizeValue(value);
    const normalizedName = normalizeActorName(normalizedValue ?? "");
    if (!normalizedValue || !normalizedName || seen.has(normalizedName)) {
      continue;
    }

    seen.add(normalizedName);
    output.push(normalizedValue);
  }

  return output;
};

const ACTOR_PROFILE_METADATA_FIELDS = [
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

const toTrimmedString = (value: string | undefined): string | undefined => {
  const normalized = value?.trim().replace(/\s+/gu, " ");
  return normalized || undefined;
};

const hasActorProfileFieldValue = (value: unknown): boolean => {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return false;
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
