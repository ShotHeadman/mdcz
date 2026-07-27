import { normalizeActorName, toUniqueActorNames } from "@mdcz/shared/actorAliases";
import type { ActorProfile } from "@mdcz/shared/types";

export { normalizeActorName, toTrimmedActorName, toUniqueActorNames } from "@mdcz/shared/actorAliases";

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
