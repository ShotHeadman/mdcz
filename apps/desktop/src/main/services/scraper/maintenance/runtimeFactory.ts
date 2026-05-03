import type { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import { configManager } from "@main/services/config";
import type { PersistentCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import type { CrawlerProvider } from "@main/services/crawler";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { MaintenanceRuntime } from "@mdcz/runtime/maintenance";
import { TranslateService } from "@mdcz/runtime/scrape";
import { AggregationService } from "../aggregation";
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
