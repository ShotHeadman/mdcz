import type { ActorImageService } from "@main/services/ActorImageService";
import { configManager } from "@main/services/config";
import type { PersistentCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import type { SignalService } from "@main/services/SignalService";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import type { CrawlerProvider } from "@mdcz/runtime/crawler";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import { AggregationService, TranslateService } from "@mdcz/runtime/scrape";
import { DownloadManager } from "../DownloadManager";
import { fileOrganizer } from "../fileOrganizerAdapter";
import { NfoGenerator } from "../NfoGenerator";
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
    }),
    fileOrganizer,
    nfoGenerator: new NfoGenerator(),
    signalService: options.signalService,
    translateService: new TranslateService(options.networkClient, {
      logger: loggerService.getLogger("TranslateService"),
      mappingStore: translationMappingStore,
    }),
    useRootHostPathAsMediaPath: false,
  });
};
