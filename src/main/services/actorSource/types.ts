import type { Configuration } from "@main/services/config";
import type { ActorProfileMetadataField } from "@main/utils/actorProfile";
import type { Website } from "@shared/enums";
import type { ActorProfile } from "@shared/types";

export const ACTOR_OVERVIEW_SOURCE_OPTIONS = ["official", "avjoho", "avbase"] as const;
export const ACTOR_IMAGE_SOURCE_OPTIONS = ["local", "gfriends", "official", "avbase"] as const;

export type ActorOverviewSourceName = (typeof ACTOR_OVERVIEW_SOURCE_OPTIONS)[number];
export type ActorImageSourceName = (typeof ACTOR_IMAGE_SOURCE_OPTIONS)[number];
export type ActorSourceName = ActorOverviewSourceName | ActorImageSourceName;
export type ActorProfileField = ActorProfileMetadataField;

export interface ActorSourceHint {
  website?: Website;
  agency?: string;
  studio?: string;
  publisher?: string;
  sourceUrl?: string;
}

export interface ActorLookupQuery {
  name: string;
  aliases?: string[];
  sourceHints?: ActorSourceHint[];
  requiredField?: ActorProfileField;
}

export interface ActorSourceResult {
  source: ActorSourceName;
  success: boolean;
  profile?: ActorProfile;
  warnings: string[];
  sourceHints?: ActorSourceHint[];
}

export interface ActorLookupResult {
  profile: ActorProfile;
  profileSources: Partial<Record<ActorProfileField, ActorSourceName>>;
  sourceResults: ActorSourceResult[];
  warnings: string[];
}

export interface BaseActorSource {
  readonly name: ActorSourceName;
  lookup(configuration: Configuration, query: ActorLookupQuery): Promise<ActorSourceResult>;
}
