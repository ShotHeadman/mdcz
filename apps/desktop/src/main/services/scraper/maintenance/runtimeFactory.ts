import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { SignalService } from "@main/services/SignalService";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import type { ActorImageService } from "@mdcz/runtime/scrape";
import { AggregationService, DownloadManager, NfoGenerator, TranslateService } from "@mdcz/runtime/scrape";
import { fileOrganizer } from "../FileScraper";
import { translationMappingStore } from "../translationMappingStore";

export interface DesktopMaintenanceRuntimeOptions {
  actorImageService: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  crawlerProvider: CrawlerProvider;
  imageHostCooldownStore: PersistentCooldownStore;
  networkClient: NetworkClient;
  signalService: SignalService;
}

export const createDesktopMaintenanceRuntime = (options: DesktopMaintenanceRuntimeOptions): MaintenanceRuntime => {
  const logger = loggerService.getLogger("MaintenanceService");
  return new MaintenanceRuntime({
    actorImageService: options.actorImageService,
    actorSourceProvider: options.actorSourceProvider,
    aggregationService: new AggregationService(options.crawlerProvider, { logger }),
    config: {
      get: async () => await configManager.getValidated(),
    },
    downloadManager: new DownloadManager(options.networkClient, {
      imageHostCooldownStore: options.imageHostCooldownStore,
      logger: loggerService.getLogger("DownloadManager"),
    }),
    fileOrganizer,
    networkPolicyClient: options.networkClient,
    nfoGenerator: new NfoGenerator(),
    signalService: options.signalService,
    translateService: new TranslateService(options.networkClient, {
      logger: loggerService.getLogger("TranslateService"),
      mappingStore: translationMappingStore,
    }),
  });
};
