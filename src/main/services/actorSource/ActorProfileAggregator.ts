import type { Configuration } from "@main/services/config";
import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import { ACTOR_PROFILE_METADATA_FIELDS, hasActorProfileFieldValue } from "@main/utils/actorProfile";
import type { ActorProfile } from "@shared/types";
import type { ActorLookupQuery, ActorLookupResult, ActorSourceName, ActorSourceResult } from "./types";

type OverviewProfileField = Exclude<(typeof ACTOR_PROFILE_METADATA_FIELDS)[number], "photo_url">;

const OVERVIEW_PROFILE_FIELDS = ACTOR_PROFILE_METADATA_FIELDS.filter(
  (field): field is OverviewProfileField => field !== "photo_url",
);
const STRUCTURED_OVERVIEW_FIELDS = OVERVIEW_PROFILE_FIELDS.filter((field) => field !== "description");
const PRIMARY_OVERVIEW_MIN_SCORE = 2;

const pickProfileField = (
  results: ActorSourceResult[],
  order: readonly ActorSourceName[],
  field: (typeof ACTOR_PROFILE_METADATA_FIELDS)[number],
): { source?: ActorSourceName; value?: ActorProfile[typeof field] } => {
  for (const sourceName of order) {
    const result = results.find((entry) => entry.source === sourceName && entry.success);
    const value = result?.profile?.[field];
    if (hasActorProfileFieldValue(value)) {
      return { source: sourceName, value };
    }
  }

  return {};
};

const normalizeName = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const countStructuredOverviewFields = (profile: ActorProfile): number => {
  return STRUCTURED_OVERVIEW_FIELDS.reduce(
    (count, field) => count + (hasActorProfileFieldValue(profile[field]) ? 1 : 0),
    0,
  );
};

const describeOverviewQuality = (profile: ActorProfile): number => {
  const structuredFieldCount = countStructuredOverviewFields(profile);
  const description = normalizeName(profile.description);
  const descriptionScore = !description ? 0 : description.length >= 160 ? 2 : description.length >= 80 ? 1.5 : 1;

  return structuredFieldCount + descriptionScore;
};

const hasOverviewContent = (profile: ActorProfile): boolean => {
  return OVERVIEW_PROFILE_FIELDS.some((field) => hasActorProfileFieldValue(profile[field]));
};

const pickPrimaryOverviewResult = (
  results: ActorSourceResult[],
  order: readonly ActorSourceName[],
): ActorSourceResult | undefined => {
  const prioritized = order.flatMap((sourceName) => {
    const result = results.find((entry) => entry.source === sourceName && entry.success && entry.profile);
    return result?.profile && hasOverviewContent(result.profile) ? [result] : [];
  });

  return (
    prioritized.find(
      (result) => result.profile && describeOverviewQuality(result.profile) >= PRIMARY_OVERVIEW_MIN_SCORE,
    ) ?? prioritized[0]
  );
};

export class ActorProfileAggregator {
  aggregate(configuration: Configuration, query: ActorLookupQuery, results: ActorSourceResult[]): ActorLookupResult {
    const profiles = results.flatMap((result) => (result.success && result.profile ? [result.profile] : []));
    const primaryOverviewResult = pickPrimaryOverviewResult(results, configuration.personSync.personOverviewSources);
    const photoSource = pickProfileField(results, configuration.personSync.personImageSources, "photo_url");
    const primaryProfile = primaryOverviewResult?.profile;
    const mergedName =
      normalizeName(primaryProfile?.name) ??
      normalizeName(profiles.find((profile) => normalizeName(profile.name))?.name) ??
      query.name.trim();
    const aliases = toUniqueActorNames([
      ...(query.aliases ?? []),
      ...(primaryProfile?.aliases ?? []),
      ...(!primaryProfile ? profiles.flatMap((profile) => profile.aliases ?? []) : []),
    ]).filter((alias) => normalizeActorName(alias) !== normalizeActorName(mergedName));

    const profile: ActorProfile = {
      name: mergedName,
      aliases: aliases.length > 0 ? aliases : undefined,
    };

    const profileSources: Partial<Record<(typeof ACTOR_PROFILE_METADATA_FIELDS)[number], ActorSourceName>> = {};

    for (const field of OVERVIEW_PROFILE_FIELDS) {
      const value = primaryProfile?.[field];
      if (!hasActorProfileFieldValue(value)) {
        continue;
      }

      Object.assign(profile, { [field]: value });
      if (primaryOverviewResult) {
        profileSources[field] = primaryOverviewResult.source;
      }
    }

    if (typeof photoSource.value === "string" && photoSource.value.trim().length > 0) {
      profile.photo_url = photoSource.value;
      if (photoSource.source) {
        profileSources.photo_url = photoSource.source;
      }
    }

    return {
      profile,
      profileSources,
      sourceResults: results,
      warnings: results.flatMap((result) => result.warnings),
    };
  }
}
