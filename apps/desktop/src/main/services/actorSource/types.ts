import type { Configuration } from "@main/services/config";
import type { ActorProfileMetadataField } from "@main/utils/actorProfile";
import {
  ACTOR_IMAGE_SOURCE_OPTIONS,
  ACTOR_OVERVIEW_SOURCE_OPTIONS,
  type ActorImageSourceName,
  type ActorOverviewSourceName,
  type ActorSourceName,
} from "@mdcz/shared/actorSource";
import type { Website } from "@mdcz/shared/enums";
import type { ActorProfile } from "@mdcz/shared/types";

export { ACTOR_IMAGE_SOURCE_OPTIONS, ACTOR_OVERVIEW_SOURCE_OPTIONS };
export type { ActorImageSourceName, ActorOverviewSourceName, ActorSourceName };
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
