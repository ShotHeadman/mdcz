import type { Configuration } from "@mdcz/shared/config";
import type { Website } from "@mdcz/shared/enums";
import type { ActorProfile } from "@mdcz/shared/types";

export interface RuntimeActorSourceHint {
  website?: Website;
  agency?: string;
  studio?: string;
  publisher?: string;
  sourceUrl?: string;
}

export interface RuntimeActorImageService {
  prepareActorProfilesForMovie(
    configuration: Configuration,
    input: {
      movieDir: string;
      actors: string[];
      actorProfiles?: ActorProfile[];
      actorPhotoBaseDir?: string;
      actorSourceProvider?: unknown;
      sourceHints?: RuntimeActorSourceHint[];
      signal?: AbortSignal;
    },
  ): Promise<ActorProfile[] | undefined>;
}

const normalizeHintValue = (value: string | undefined): string | undefined => {
  const normalized = value?.normalize("NFC").trim().replace(/\s+/gu, " ");
  return normalized || undefined;
};

const normalizeHint = (hint: RuntimeActorSourceHint): RuntimeActorSourceHint | null => {
  const normalized: RuntimeActorSourceHint = {
    website: hint.website,
    agency: normalizeHintValue(hint.agency),
    studio: normalizeHintValue(hint.studio),
    publisher: normalizeHintValue(hint.publisher),
    sourceUrl: normalizeHintValue(hint.sourceUrl),
  };

  return normalized.website || normalized.agency || normalized.studio || normalized.publisher || normalized.sourceUrl
    ? normalized
    : null;
};

export const mergeRuntimeActorSourceHints = (
  ...groups: Array<RuntimeActorSourceHint[] | undefined>
): RuntimeActorSourceHint[] => {
  const seen = new Set<string>();
  const merged: RuntimeActorSourceHint[] = [];

  for (const group of groups) {
    for (const hint of group ?? []) {
      const normalized = normalizeHint(hint);
      if (!normalized) {
        continue;
      }

      const key = JSON.stringify(normalized);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(normalized);
    }
  }

  return merged;
};
