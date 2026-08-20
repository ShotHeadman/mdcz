import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import type { NetworkClient } from "@mdcz/runtime/network";
import { AggregationService, MountedRootScrapeRuntime } from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import { createServerActorSourceProvider } from "./actorSourceFactory";
import { getServerImageHostCooldownStore } from "./imageHostCooldownStore";
import type { ServerConfigService } from "./services/configService";

export const createServerScrapeRuntime = (
  config: ServerConfigService,
  networkClient: NetworkClient,
  mappingStore?: TranslationMappingStore,
): MountedRootScrapeRuntime => {
  const logger = runtimeLoggerService.getLogger("scrape");
  return new MountedRootScrapeRuntime(
    config,
    new AggregationService(
      new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient), siteRequestConfigRegistrar: networkClient }),
      { logger },
    ),
    logger,
    networkClient,
    mappingStore,
    getServerImageHostCooldownStore(config),
    createServerActorSourceProvider(config, networkClient),
  );
};
