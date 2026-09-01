import { getActorImageCacheDirectory, resolveDesktopDataFile } from "@main/appIdentity";
import type { ServiceContainer } from "@main/container";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { DesktopLibraryService, OutputLibraryScanner } from "@main/services/library";
import { createDesktopMediaRootService } from "@main/services/mediaRoots";
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
  const mediaRoots = createDesktopMediaRootService(persistenceService);
  const reportUnavailableMediaPath = (hostPath: string, error: unknown) => {
    configManager.reportDiagnostic(
      "read-error",
      new Error(`Configured media root unavailable: ${hostPath}: ${String(error)}`),
    );
  };
  configManager.setBeforeActiveConfigurationCommit(async (next, { source }) => {
    await mediaRoots.assertConfiguredMediaPath(
      next,
      source === "load" || source === "watch" ? reportUnavailableMediaPath : undefined,
    );
  });
  configManager.setAfterActiveConfigurationCommit(async (next, { source }) => {
    await mediaRoots.registerConfiguredMediaPath(
      next,
      source === "load" || source === "watch" ? reportUnavailableMediaPath : undefined,
    );
  });
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
    mediaRoots,
  );
  const maintenanceService = new MaintenanceService({
    signalService,
    networkClient,
    crawlerProvider,
    persistenceService,
    actorImageService,
    actorSourceProvider,
    imageHostCooldownStore,
    mediaRoots,
  });

  return {
    signalService,
    windowService,
    networkClient,
    fetchGateway,
    outputLibraryScanner,
    desktopLibraryService,
    persistenceService,
    mediaRoots,
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
    amazonPosterToolService: new AmazonPosterToolService(
      networkClient,
      amazonJpImageService,
      persistenceService,
      mediaRoots,
    ),
    batchTranslateToolService: new BatchTranslateToolService(networkClient, persistenceService, {}, mediaRoots),
    shutdown: async () => {
      let firstError: unknown;
      for (const shutdown of [
        async () => await scraperService.shutdown(),
        async () => await maintenanceService.shutdown(),
        async () => await crawlerProvider.shutdown(),
      ]) {
        try {
          await shutdown();
        } catch (error) {
          firstError ??= error;
        }
      }
      try {
        await persistenceService.close();
      } catch (error) {
        firstError ??= error;
      }
      if (firstError) throw firstError;
    },
  };
};
