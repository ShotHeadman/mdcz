import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import type { NetworkClient } from "@mdcz/runtime/network";
import { type ActorImageService, AggregationService, MountedRootScrapeRuntime } from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import type { ServerConfigService } from "./services/configService";

export interface ServerScrapeRuntimeDependencies {
  config: ServerConfigService;
  networkClient: NetworkClient;
  crawlerProvider: CrawlerProvider;
  imageHostCooldownStore: PersistentCooldownStore;
  actorImageService: ActorImageService;
  actorSourceProvider: ActorSourceProvider;
  mappingStore?: TranslationMappingStore;
}

export const createServerScrapeRuntime = (deps: ServerScrapeRuntimeDependencies): MountedRootScrapeRuntime => {
  const logger = runtimeLoggerService.getLogger("scrape");
  return new MountedRootScrapeRuntime({
    config: deps.config,
    aggregationService: new AggregationService(deps.crawlerProvider, { logger }),
    logger,
    networkClient: deps.networkClient,
    mappingStore: deps.mappingStore,
    imageHostCooldownStore: deps.imageHostCooldownStore,
    actorSourceProvider: deps.actorSourceProvider,
    actorImageService: deps.actorImageService,
  });
};
