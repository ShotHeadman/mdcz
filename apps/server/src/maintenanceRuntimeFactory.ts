import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import { NetworkClient } from "@mdcz/runtime/network";
import {
  ActorImageService,
  AggregationService,
  DownloadManager,
  FileOrganizer,
  NfoGenerator,
  TranslateService,
} from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import { createServerActorSourceProvider, serverActorImageCacheRoot } from "./actorSourceFactory";
import { getServerImageHostCooldownStore } from "./imageHostCooldownStore";
import type { ServerConfigService } from "./services/configService";

export const createServerMaintenanceRuntime = (
  config: ServerConfigService,
  mappingStore?: TranslationMappingStore,
): MaintenanceRuntime => {
  const networkClient = new NetworkClient();
  const logger = runtimeLoggerService.getLogger("maintenance");
  const actorImageService = new ActorImageService({
    cacheRoot: serverActorImageCacheRoot(config),
    logger,
    networkClient,
  });
  return new MaintenanceRuntime({
    actorImageService,
    actorSourceProvider: createServerActorSourceProvider(config, networkClient, actorImageService),
    aggregationService: new AggregationService(
      new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient), siteRequestConfigRegistrar: networkClient }),
      { logger },
    ),
    config,
    downloadManager: new DownloadManager(networkClient, {
      imageHostCooldownStore: getServerImageHostCooldownStore(config),
      logger,
    }),
    fileOrganizer: new FileOrganizer(logger),
    nfoGenerator: new NfoGenerator(),
    signalService: {
      setProgress: () => undefined,
      showLogText: () => undefined,
    },
    translateService: new TranslateService(networkClient, { logger, mappingStore }),
  });
};
