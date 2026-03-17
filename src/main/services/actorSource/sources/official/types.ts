import type { NetworkClient } from "@main/services/network";
import type { ActorProfile } from "@shared/types";
import type { ActorSourceHint } from "../../types";

export interface OfficialActorSourceDependencies {
  networkClient: NetworkClient;
}

export interface OfficialLookupRequest {
  queryNames: string[];
  fallbackName: string;
}

export interface OfficialLookupResult {
  profile: ActorProfile;
  sourceHints: ActorSourceHint[];
}

export interface OfficialSiteAdapter {
  readonly key: string;
  matchesHints(hints: ActorSourceHint[]): boolean;
  lookup(query: OfficialLookupRequest): Promise<OfficialLookupResult | null>;
}
