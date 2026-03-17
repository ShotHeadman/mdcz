import type { Configuration } from "@main/services/config";
import { mergeActorProfiles } from "@main/utils/actorProfile";
import { mergeActorSourceHints } from "../../sourceHints";
import type { ActorLookupQuery, ActorSourceResult, BaseActorSource } from "../../types";
import { createOfficialAgencyAdapters } from "./agency";
import { toUniqueNames } from "./shared";
import { createOfficialStudioAdapters } from "./studio";
import type { OfficialActorSourceDependencies, OfficialLookupResult, OfficialSiteAdapter } from "./types";

export type { OfficialActorSourceDependencies } from "./types";

export class OfficialActorSource implements BaseActorSource {
  readonly name = "official" as const;

  private readonly adapters: OfficialSiteAdapter[];

  constructor(deps: OfficialActorSourceDependencies) {
    this.adapters = [...createOfficialAgencyAdapters(deps), ...createOfficialStudioAdapters(deps)];
  }

  async lookup(_configuration: Configuration, query: ActorLookupQuery): Promise<ActorSourceResult> {
    const hints = mergeActorSourceHints(query.sourceHints);
    const candidates = this.adapters.filter((adapter) => adapter.matchesHints(hints));
    if (candidates.length === 0) {
      return {
        source: this.name,
        success: true,
        warnings: [],
      };
    }

    const queryNames = toUniqueNames([query.name, ...(query.aliases ?? [])]);
    const warnings: string[] = [];
    let hadError = false;
    const matchedResults: OfficialLookupResult[] = [];

    for (const adapter of candidates) {
      try {
        const result = await adapter.lookup({
          queryNames,
          fallbackName: query.name.trim(),
        });
        if (result) {
          matchedResults.push(result);
        }
      } catch (error) {
        hadError = true;
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to load official actor data from ${adapter.key}: ${message}`);
      }
    }

    if (matchedResults.length > 0) {
      const profile = mergeActorProfiles(matchedResults.map((result) => result.profile));
      if (profile) {
        return {
          source: this.name,
          success: true,
          profile,
          warnings,
          sourceHints: mergeActorSourceHints(...matchedResults.map((result) => result.sourceHints)),
        };
      }
    }

    return {
      source: this.name,
      success: !hadError,
      warnings,
    };
  }
}
