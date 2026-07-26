import { normalizeActorName, resolveActorAlias, toUniqueActorNames } from "@mdcz/shared/actorAliases";
import type { Configuration } from "@mdcz/shared/config";
import type { ActorProfile, CrawlerData } from "@mdcz/shared/types";
import { mergeActorProfiles } from "./actorImage/utils";

type CanonicalizedActor = {
  canonicalName: string;
  originalName: string;
};

const canonicalizeActor = (configuration: Configuration, name: string): CanonicalizedActor => {
  const resolved = resolveActorAlias(configuration.personSync.actorAliases, name);
  return {
    canonicalName: resolved.canonicalName,
    originalName: name.trim(),
  };
};

const mergeCanonicalProfile = (
  configuration: Configuration,
  profile: ActorProfile,
  actorAliases: ReadonlyArray<string>,
): ActorProfile | undefined => {
  const { canonicalName, originalName } = canonicalizeActor(configuration, profile.name);
  if (!canonicalName) {
    return undefined;
  }

  const aliases = toUniqueActorNames([
    ...(profile.aliases ?? []),
    ...actorAliases,
    ...(normalizeActorName(originalName) === normalizeActorName(canonicalName) ? [] : [originalName]),
  ]).filter((alias) => normalizeActorName(alias) !== normalizeActorName(canonicalName));

  return {
    ...profile,
    name: canonicalName,
    aliases: aliases.length > 0 ? aliases : undefined,
  };
};

export const canonicalizeCrawlerDataActorAliases = (
  crawlerData: CrawlerData,
  configuration: Configuration,
): CrawlerData => {
  const rawActors = crawlerData.actors ?? [];
  const canonicalActors = rawActors.map((name) => canonicalizeActor(configuration, name));
  const actors = toUniqueActorNames(canonicalActors.map((actor) => actor.canonicalName));
  const aliasesByCanonicalName = new Map<string, string[]>();

  for (const actor of canonicalActors) {
    const canonicalKey = normalizeActorName(actor.canonicalName);
    if (!canonicalKey || normalizeActorName(actor.originalName) === canonicalKey) {
      continue;
    }

    const aliases = aliasesByCanonicalName.get(canonicalKey) ?? [];
    aliases.push(actor.originalName);
    aliasesByCanonicalName.set(canonicalKey, aliases);
  }

  const profilesByCanonicalName = new Map<string, ActorProfile[]>();
  for (const profile of crawlerData.actor_profiles ?? []) {
    const canonicalProfile = mergeCanonicalProfile(
      configuration,
      profile,
      aliasesByCanonicalName.get(
        normalizeActorName(resolveActorAlias(configuration.personSync.actorAliases, profile.name).canonicalName),
      ) ?? [],
    );
    if (!canonicalProfile) {
      continue;
    }

    const key = normalizeActorName(canonicalProfile.name);
    const profiles = profilesByCanonicalName.get(key) ?? [];
    profiles.push(canonicalProfile);
    profilesByCanonicalName.set(key, profiles);
  }

  for (const actor of actors) {
    const key = normalizeActorName(actor);
    const aliases = aliasesByCanonicalName.get(key);
    if (!aliases?.length || profilesByCanonicalName.has(key)) {
      continue;
    }

    profilesByCanonicalName.set(key, [{ name: actor, aliases: toUniqueActorNames(aliases) }]);
  }

  const actor_profiles = Array.from(profilesByCanonicalName.values())
    .map((profiles) => mergeActorProfiles(profiles))
    .filter((profile): profile is ActorProfile => Boolean(profile));

  return {
    ...crawlerData,
    actors: actors.length > 0 ? actors : crawlerData.actors,
    actor_profiles: actor_profiles.length > 0 ? actor_profiles : crawlerData.actor_profiles,
  };
};
