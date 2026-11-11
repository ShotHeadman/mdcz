import { normalizeActorName } from "./actorAliases";
import type { CrawlerData, NfoEditorField } from "./types";

export const applyNfoEditorChanges = (
  current: CrawlerData,
  edited: CrawlerData,
  changedFields: readonly NfoEditorField[],
): CrawlerData => {
  const data: CrawlerData = {
    ...current,
    ...Object.fromEntries(changedFields.map((field) => [field, edited[field]])),
  };
  if (changedFields.includes("actor_profiles")) {
    const profiles = new Map(current.actor_profiles?.map((profile) => [normalizeActorName(profile.name), profile]));
    data.actor_profiles = edited.actor_profiles?.map((profile) => ({
      ...profiles.get(normalizeActorName(profile.name)),
      name: profile.name,
      photo_url: profile.photo_url,
    }));
  }
  if (changedFields.includes("actors") || changedFields.includes("actor_profiles")) {
    const actors = new Set(data.actors.map(normalizeActorName));
    data.actor_profiles = data.actor_profiles?.filter((profile) => actors.has(normalizeActorName(profile.name)));
  }
  return data;
};
