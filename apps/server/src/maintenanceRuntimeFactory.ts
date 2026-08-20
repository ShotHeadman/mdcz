import path from "node:path";
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
import { getServerImageHostCooldownStore } from "./imageHostCooldownStore";
import type { ServerConfigService } from "./services/configService";

export const createServerMaintenanceRuntime = (
  config: ServerConfigService,
  mappingStore?: TranslationMappingStore,
): MaintenanceRuntime => {
  const networkClient = new NetworkClient();
  const logger = runtimeLoggerService.getLogger("maintenance");
  return new MaintenanceRuntime({
    actorImageService: new ActorImageService({
      cacheRoot: path.join(config.runtimePaths.dataDir, "actor-image-cache"),
      logger,
      networkClient,
    }),
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
