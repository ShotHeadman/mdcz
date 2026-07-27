import { normalizeActorName, resolveActorAlias, toUniqueActorNames } from "@mdcz/shared/actorAliases";
import type { Configuration } from "@mdcz/shared/config";
import type { ActorProfile, CrawlerData } from "@mdcz/shared/types";
import { mergeActorProfiles } from "./actorImage/utils";

export const canonicalizeCrawlerDataActorAliases = (
  crawlerData: CrawlerData,
  configuration: Configuration,
): CrawlerData => {
  const { actorAliases } = configuration.personSync;
  const canonicalActors = (crawlerData.actors ?? []).map((name) => ({
    canonicalName: resolveActorAlias(actorAliases, name).canonicalName,
    originalName: name.trim(),
  }));
  const actors = toUniqueActorNames(canonicalActors.map((actor) => actor.canonicalName));

  const profilesByCanonicalName = new Map<string, ActorProfile[]>();
  const addProfile = (canonicalName: string, profile: ActorProfile): void => {
    const key = normalizeActorName(canonicalName);
    const profiles = profilesByCanonicalName.get(key) ?? [];
    profiles.push(profile);
    profilesByCanonicalName.set(key, profiles);
  };

  for (const profile of crawlerData.actor_profiles ?? []) {
    const { canonicalName } = resolveActorAlias(actorAliases, profile.name);
    if (!canonicalName) {
      continue;
    }

    addProfile(canonicalName, {
      ...profile,
      name: canonicalName,
      aliases: toUniqueActorNames([...(profile.aliases ?? []), profile.name]),
    });
  }

  for (const { canonicalName, originalName } of canonicalActors) {
    if (!canonicalName || normalizeActorName(originalName) === normalizeActorName(canonicalName)) {
      continue;
    }

    addProfile(canonicalName, { name: canonicalName, aliases: [originalName] });
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
