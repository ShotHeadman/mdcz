import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import {
  type ActorImageService,
  AggregationService,
  DownloadManager,
  FileOrganizer,
  NfoGenerator,
  TranslateService,
} from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import type { TranslationMappingStore } from "@mdcz/runtime/translate";
import type { ServerConfigService } from "./services/configService";

export interface ServerMaintenanceRuntimeDependencies {
  config: ServerConfigService;
  networkClient: NetworkClient;
  crawlerProvider: CrawlerProvider;
  imageHostCooldownStore: PersistentCooldownStore;
  actorImageService: ActorImageService;
  actorSourceProvider: ActorSourceProvider;
  mappingStore?: TranslationMappingStore;
}

export const createServerMaintenanceRuntime = (deps: ServerMaintenanceRuntimeDependencies): MaintenanceRuntime => {
  const logger = runtimeLoggerService.getLogger("maintenance");
  return new MaintenanceRuntime({
    actorImageService: deps.actorImageService,
    actorSourceProvider: deps.actorSourceProvider,
    aggregationService: new AggregationService(deps.crawlerProvider, { logger }),
    config: deps.config,
    downloadManager: new DownloadManager(deps.networkClient, {
      imageHostCooldownStore: deps.imageHostCooldownStore,
      logger,
    }),
    fileOrganizer: new FileOrganizer(logger),
    networkPolicyClient: deps.networkClient,
    nfoGenerator: new NfoGenerator(),
    signalService: {
      setProgress: () => undefined,
      showLogText: () => undefined,
    },
    translateService: new TranslateService(deps.networkClient, { logger, mappingStore: deps.mappingStore }),
  });
};
