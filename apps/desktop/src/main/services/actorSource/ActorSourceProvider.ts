import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import { hasActorProfileFieldValue } from "@main/utils/actorProfile";
import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { toErrorMessage } from "@main/utils/common";
import { ActorProfileAggregator } from "./ActorProfileAggregator";
import type { ActorSourceRegistry } from "./registry";
import { mergeActorSourceHints } from "./sourceHints";
import type { ActorLookupQuery, ActorLookupResult, ActorSourceName, ActorSourceResult } from "./types";

const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;

export interface ActorSourceProviderDependencies {
  registry: ActorSourceRegistry;
  aggregator?: ActorProfileAggregator;
}

const uniqueSourceNames = (configuration: Configuration): ActorSourceName[] => {
  const selected = new Set<ActorSourceName>();

  for (const source of configuration.personSync.personOverviewSources) {
    selected.add(source);
  }
  for (const source of configuration.personSync.personImageSources) {
    selected.add(source);
  }

  return Array.from(selected);
};

const mergeAliases = (name: string, aliases: string[]): string[] => {
  return toUniqueActorNames(aliases).filter((alias) => normalizeActorName(alias) !== normalizeActorName(name));
};

const buildExecutionOrder = (
  configuration: Configuration,
  selected: ActorSourceName[],
  requiredField?: string,
): ActorSourceName[] => {
  if (requiredField === "photo_url") {
    return Array.from(new Set(configuration.personSync.personImageSources));
  }

  const ordered: ActorSourceName[] = [];

  if (selected.includes("local")) {
    ordered.push("local");
  }

  for (const sourceName of selected) {
    if (sourceName === "local" || sourceName === "official") {
      continue;
    }
    ordered.push(sourceName);
  }

  if (selected.includes("official")) {
    ordered.push("official");
  }

  return ordered;
};

const mergeLookupQuery = (query: ActorLookupQuery, result: ActorSourceResult): ActorLookupQuery => {
  return {
    ...query,
    aliases: mergeAliases(query.name, [
      result.profile?.name ?? "",
      ...(query.aliases ?? []),
      ...(result.profile?.aliases ?? []),
    ]),
    sourceHints: mergeActorSourceHints(query.sourceHints, result.sourceHints),
  };
};

const normalizeHintsForCache = (hints: ActorLookupQuery["sourceHints"]): string[] => {
  return mergeActorSourceHints(hints).map((hint) => JSON.stringify(hint));
};

export class ActorSourceProvider {
  private readonly logger = loggerService.getLogger("ActorSource");

  private readonly aggregator: ActorProfileAggregator;

  private readonly lookupResolver = new CachedAsyncResolver<string, ActorLookupResult>();

  private lookupBucket = "";

  constructor(private readonly deps: ActorSourceProviderDependencies) {
    this.aggregator = deps.aggregator ?? new ActorProfileAggregator();
  }

  async lookup(configuration: Configuration, query: string | ActorLookupQuery): Promise<ActorLookupResult> {
    const baseQuery: ActorLookupQuery =
      typeof query === "string"
        ? {
            name: query,
            requiredField: undefined,
          }
        : {
            ...query,
            aliases: mergeAliases(query.name, query.aliases ?? []),
            sourceHints: mergeActorSourceHints(query.sourceHints),
          };
    const normalized = normalizeActorName(baseQuery.name);
    const bucket = String(Math.floor(Date.now() / LOOKUP_CACHE_TTL_MS));

    if (bucket !== this.lookupBucket) {
      this.lookupResolver.clear();
      this.lookupBucket = bucket;
    }

    if (!normalized) {
      return this.aggregator.aggregate(configuration, baseQuery, []);
    }

    return this.lookupResolver.resolve(this.buildCacheKey(configuration, normalized, baseQuery), async () => {
      const selected = uniqueSourceNames(configuration);
      const executionOrder = buildExecutionOrder(configuration, selected, baseQuery.requiredField);
      const results: ActorSourceResult[] = [];
      let enrichedQuery = baseQuery;

      for (const sourceName of executionOrder) {
        const result = await this.lookupSource(sourceName, configuration, enrichedQuery);
        results.push(result);
        if (
          baseQuery.requiredField &&
          result.success &&
          hasActorProfileFieldValue(result.profile?.[baseQuery.requiredField])
        ) {
          break;
        }
        enrichedQuery = mergeLookupQuery(enrichedQuery, result);
      }

      return this.aggregator.aggregate(configuration, enrichedQuery, results);
    });
  }

  private async lookupSource(
    sourceName: ActorSourceName,
    configuration: Configuration,
    query: ActorLookupQuery,
  ): Promise<ActorSourceResult> {
    const source = this.deps.registry.get(sourceName);
    if (!source) {
      return {
        source: sourceName,
        success: false,
        warnings: [`Actor source "${sourceName}" is not registered.`],
      };
    }

    try {
      return await source.lookup(configuration, query);
    } catch (error) {
      const message = `Actor source "${sourceName}" failed for ${query.name}: ${toErrorMessage(error)}`;
      this.logger.warn(message);
      return {
        source: sourceName,
        success: false,
        warnings: [message],
      };
    }
  }

  private buildCacheKey(configuration: Configuration, normalizedName: string, query: ActorLookupQuery): string {
    return JSON.stringify({
      name: normalizedName,
      aliases: query.aliases ?? [],
      sourceHints: normalizeHintsForCache(query.sourceHints),
      requiredField: query.requiredField,
      mediaPath: configuration.paths.mediaPath.trim(),
      actorPhotoFolder: configuration.paths.actorPhotoFolder.trim(),
      personOverviewSources: configuration.personSync.personOverviewSources,
      personImageSources: configuration.personSync.personImageSources,
    });
  }
}
