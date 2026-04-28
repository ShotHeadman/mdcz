import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import type { ActorSourceHint } from "../../types";
import { createCacheBucket } from "./shared";
import type {
  OfficialActorSourceDependencies,
  OfficialLookupRequest,
  OfficialLookupResult,
  OfficialSiteAdapter,
} from "./types";

interface RosterOfficialAdapterConfig {
  key: string;
  rateLimitedHosts: string[];
}

export abstract class BaseRosterOfficialAdapter<TRoster> implements OfficialSiteAdapter {
  readonly key: string;

  protected readonly deps: OfficialActorSourceDependencies;

  private readonly rosterResolver = new CachedAsyncResolver<string, TRoster>();

  private rosterBucket = "";

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

    return await this.rosterResolver.resolve(this.key, loadRoster);
  }

  abstract matchesHints(hints: ActorSourceHint[]): boolean;
  abstract lookup(query: OfficialLookupRequest): Promise<OfficialLookupResult | null>;
}
