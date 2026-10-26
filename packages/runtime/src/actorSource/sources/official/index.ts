import { isUnrecoverableNetworkError } from "@mdcz/runtime/network";
import { mergeActorProfiles, toErrorMessage } from "@mdcz/runtime/shared";
import type { Configuration } from "@mdcz/shared/config";
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

    const queryNames = toUniqueNames([query.name, ...(query.aliases ?? [])]);
    const warnings: string[] = [];
    let hadError = false;

    // Every agency roster is checked on each lookup; each site has its own host and rate limit, so they load at once.
    const lookups = await Promise.all(
      candidates.map(async (adapter) => {
        try {
          return await adapter.lookup({ queryNames, fallbackName: query.name.trim() });
        } catch (error) {
          if (isUnrecoverableNetworkError(error)) throw error;
          hadError = true;
          warnings.push(`Failed to load official actor data from ${adapter.key}: ${toErrorMessage(error)}`);
          return null;
        }
      }),
    );
    const matchedResults = lookups.filter((result): result is OfficialLookupResult => result !== null);

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
