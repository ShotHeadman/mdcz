import { isUnrecoverableNetworkError, runWithSharedNetworkData } from "@mdcz/runtime/network";
import { CachedAsyncResolver } from "@mdcz/runtime/shared";
import type { ActorSourceHint } from "../../types";
import { createCacheBucket } from "./shared";
import type {
  OfficialActorSourceDependencies,
  OfficialLookupRequest,
  OfficialLookupResult,
  OfficialSiteAdapter,
} from "./types";

// Every actor lookup checks the agency rosters, so a site that is down would otherwise be refetched for each actor.
const ROSTER_FAILURE_TTL_MS = 5 * 60 * 1000;

interface RosterOfficialAdapterConfig {
  key: string;
  rateLimitedHosts: string[];
}

export abstract class BaseRosterOfficialAdapter<TRoster> implements OfficialSiteAdapter {
  readonly key: string;

  protected readonly deps: OfficialActorSourceDependencies;

  private readonly rosterResolver = new CachedAsyncResolver<string, TRoster>();

  private rosterBucket = "";

  private rosterFailure: { error: unknown; until: number } | undefined;

  protected constructor(deps: OfficialActorSourceDependencies, config: RosterOfficialAdapterConfig) {
    this.deps = deps;
    this.key = config.key;

    for (const host of config.rateLimitedHosts) {
      deps.networkClient.setDomainLimit?.(host, 1, 1);
    }
  }

  protected async loadCachedRoster(loadRoster: () => Promise<TRoster>): Promise<TRoster> {
    const bucket = createCacheBucket();
    if (bucket !== this.rosterBucket) {
      this.rosterResolver.clear();
      this.rosterBucket = bucket;
    }

    if (this.rosterFailure && Date.now() < this.rosterFailure.until) throw this.rosterFailure.error;
    try {
      return await this.rosterResolver.resolve(this.key, async () => await runWithSharedNetworkData(loadRoster));
    } catch (error) {
      if (!isUnrecoverableNetworkError(error))
        this.rosterFailure = { error, until: Date.now() + ROSTER_FAILURE_TTL_MS };
      throw error;
    }
  }

  abstract matchesHints(hints: ActorSourceHint[]): boolean;
  abstract lookup(query: OfficialLookupRequest): Promise<OfficialLookupResult | null>;
}
