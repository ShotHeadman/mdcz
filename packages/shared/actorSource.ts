export const ACTOR_OVERVIEW_SOURCE_OPTIONS = ["official", "avjoho", "avbase"] as const;
export const ACTOR_IMAGE_SOURCE_OPTIONS = ["local", "gfriends", "official", "avbase"] as const;

export type ActorOverviewSourceName = (typeof ACTOR_OVERVIEW_SOURCE_OPTIONS)[number];
export type ActorImageSourceName = (typeof ACTOR_IMAGE_SOURCE_OPTIONS)[number];
export type ActorSourceName = ActorOverviewSourceName | ActorImageSourceName;
