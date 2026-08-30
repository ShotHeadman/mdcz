import { getActorImageCacheDirectory, resolveDesktopDataFile } from "@main/appIdentity";
import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { DesktopLibraryService, OutputLibraryScanner } from "@main/services/library";
import { createElectronCookieResolver } from "@main/services/network";
import { DesktopPersistenceService } from "@main/services/persistence";
import type { SignalService } from "@main/services/SignalService";
import { ScraperService } from "@main/services/scraper";
import { MaintenanceService } from "@main/services/scraper/maintenance/MaintenanceService";
import { AmazonPosterToolService, BatchTranslateToolService, SymlinkService } from "@main/services/tools";
import type { WindowService } from "@main/services/WindowService";
import {
  ActorSourceProvider,
  ActorSourceRegistry,
  AvbaseActorSource,
  AvjohoActorSource,
  GfriendsActorSource,
  LocalActorSource,
  OfficialActorSource,
} from "@mdcz/runtime/actorSource";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import {
  EmbyActorInfoService,
  EmbyActorPhotoService,
  JellyfinActorInfoService,
  JellyfinActorPhotoService,
} from "@mdcz/runtime/mediaserver";
import type { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService } from "@mdcz/runtime/scrape";
import { AmazonJpImageService } from "@mdcz/runtime/tools";

export interface CreateContainerOptions {
  windowService: WindowService;
  signalService: SignalService;
  networkClient: NetworkClient;
}

export const createContainer = ({
  windowService,
  signalService,
  networkClient,
}: CreateContainerOptions): ServiceContainer => {
  const fetchGateway = new FetchGateway(networkClient);
  const crawlerProvider = new CrawlerProvider({
    fetchGateway,
    siteCooldownStore: new PersistentCooldownStore({
      filePath: resolveDesktopDataFile("crawler-site-cooldowns.json"),
      logger: loggerService.getLogger("CrawlerSiteCooldownStore"),
    }),
    siteRequestConfigRegistrar: networkClient,
  });
  const imageHostCooldownStore = new PersistentCooldownStore({
    filePath: resolveDesktopDataFile("image-host-cooldowns.json"),
    logger: loggerService.getLogger("ImageHostCooldownStore"),
  });
  const persistenceService = new DesktopPersistenceService();
  const outputLibraryScanner = new OutputLibraryScanner({ persistenceService });
  const desktopLibraryService = new DesktopLibraryService(persistenceService);
  const amazonJpImageService = new AmazonJpImageService(networkClient, loggerService.getLogger("AmazonJpImageService"));
  const actorImageService = new ActorImageService({
    cacheRoot: getActorImageCacheDirectory(),
    logger: loggerService.getLogger("ActorImageService"),
    networkClient,
  });
  const avjohoCookieResolver = createElectronCookieResolver({
    expectedCookieNames: ["wsidchk"],
  });
  const actorSourceProvider = new ActorSourceProvider({
    logger: loggerService.getLogger("ActorSource"),
    registry: new ActorSourceRegistry([
      new LocalActorSource({ actorImageService }),
      new OfficialActorSource({ networkClient }),
      new GfriendsActorSource({ networkClient }),
      new AvjohoActorSource({ networkClient, cookieResolver: avjohoCookieResolver }),
      new AvbaseActorSource({ networkClient }),
    ]),
  });

  const scraperService = new ScraperService(
    signalService,
    networkClient,
    crawlerProvider,
    actorImageService,
    actorSourceProvider,
    imageHostCooldownStore,
    outputLibraryScanner,
    persistenceService,
  );
  const maintenanceService = new MaintenanceService({
    signalService,
    networkClient,
    crawlerProvider,
    persistenceService,
    actorImageService,
    actorSourceProvider,
    imageHostCooldownStore,
  });

  return {
    signalService,
    windowService,
    networkClient,
    fetchGateway,
    outputLibraryScanner,
    desktopLibraryService,
    persistenceService,
    scraperService,
    maintenanceService,
    crawlerProvider,
    actorSourceProvider,
    actorImageService,
    jellyfinActorPhotoService: new JellyfinActorPhotoService({
      signalService,
      networkClient,
      actorSourceProvider,
      logger: loggerService.getLogger("JellyfinActorPhoto"),
    }),
    jellyfinActorInfoService: new JellyfinActorInfoService({
      signalService,
      networkClient,
      actorSourceProvider,
      logger: loggerService.getLogger("JellyfinActorInfo"),
    }),
    embyActorPhotoService: new EmbyActorPhotoService({
      signalService,
      networkClient,
      actorSourceProvider,
      logger: loggerService.getLogger("EmbyActorPhoto"),
    }),
    embyActorInfoService: new EmbyActorInfoService({
      signalService,
      networkClient,
      actorSourceProvider,
      logger: loggerService.getLogger("EmbyActorInfo"),
    }),
    symlinkService: new SymlinkService({ signalService }),
    amazonPosterToolService: new AmazonPosterToolService(networkClient, amazonJpImageService, persistenceService),
    batchTranslateToolService: new BatchTranslateToolService(networkClient, persistenceService),
    shutdown: async () => {
      await Promise.allSettled([scraperService.shutdown(), maintenanceService.shutdown(), crawlerProvider.shutdown()]);
      await persistenceService.close();
    },
  };
};
