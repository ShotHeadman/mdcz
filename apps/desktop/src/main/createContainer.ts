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
import { UpdateService } from "@main/services/UpdateService";
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
import { siteNetworkKey } from "@mdcz/runtime/config";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { MediaLibraryService, PendingService } from "@mdcz/runtime/library";
import {
  EmbyActorInfoService,
  EmbyActorPhotoService,
  JellyfinActorInfoService,
  JellyfinActorPhotoService,
} from "@mdcz/runtime/mediaserver";
import type { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService, type PrepareScrapeItem } from "@mdcz/runtime/scrape";
import { AmazonJpImageService } from "@mdcz/runtime/tools";

export interface CreateContainerOptions {
  windowService: WindowService;
  signalService: SignalService;
  networkClient: NetworkClient;
  prepareScrapeItem?: PrepareScrapeItem;
}

export const createContainer = ({
  windowService,
  signalService,
  networkClient,
  prepareScrapeItem,
}: CreateContainerOptions): ServiceContainer => {
  const fetchGateway = new FetchGateway(networkClient);
  const crawlerProvider = new CrawlerProvider({
    fetchGateway,
    siteRequestConfigRegistrar: networkClient,
    getSiteNetworkKey: (site) => siteNetworkKey(configManager.getComputed(), site),
  });
  const imageHostCooldownStore = new PersistentCooldownStore({
    filePath: resolveDesktopDataFile("image-host-cooldowns.json"),
    logger: loggerService.getLogger("ImageHostCooldownStore"),
  });
  const persistenceService = new DesktopPersistenceService();
  const mediaRoots = createDesktopMediaRootService(persistenceService);
  const libraries = new MediaLibraryService(
    async () => (await persistenceService.getState()).repositories.mediaLibraries,
    mediaRoots,
    async () => await configManager.getValidated(),
  );
  const outputLibraryScanner = new OutputLibraryScanner({ persistenceService });
  const desktopLibraryService = new DesktopLibraryService(persistenceService, libraries, () =>
    configManager.getValidated(),
  );
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
      new LocalActorSource({
        actorImageService,
        listLibraryDirectories: async () =>
          (await libraries.list()).flatMap((library) => [library.sourcePath, library.outputPath].filter(Boolean)),
      }),
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
    libraries,
    outputLibraryScanner,
    persistenceService,
    mediaRoots,
    prepareScrapeItem,
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
    prepareScrapeItem,
  });
  const pendingService = new PendingService({
    repositories: async () => (await persistenceService.getState()).repositories,
    mediaRoots,
    startScrape: async (input) => ({ taskId: (await scraperService.start(input)).taskId }),
    getConfiguration: async () => await configManager.getValidated(),
    updateConfiguration: async (patch) => await configManager.save(patch),
    maintenanceRuntime: maintenanceService.maintenanceRuntime,
    onChanged: () => signalService.invalidate("pending", "overview"),
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
    libraries,
    pendingService,
    scraperService,
    maintenanceService,
    crawlerProvider,
    actorSourceProvider,
    actorImageService,
    jellyfinActorPhotoService: new JellyfinActorPhotoService({
      signalService: {
        showLogText: (message, level) => signalService.showLogText(message, level),
        resetProgress: () => undefined,
        setProgress: () => undefined,
      },
      networkClient,
      actorSourceProvider,
      logger: loggerService.getLogger("JellyfinActorPhoto"),
    }),
    jellyfinActorInfoService: new JellyfinActorInfoService({
      signalService: {
        showLogText: (message, level) => signalService.showLogText(message, level),
        resetProgress: () => undefined,
        setProgress: () => undefined,
      },
      networkClient,
      actorSourceProvider,
      logger: loggerService.getLogger("JellyfinActorInfo"),
    }),
    embyActorPhotoService: new EmbyActorPhotoService({
      signalService: {
        showLogText: (message, level) => signalService.showLogText(message, level),
        resetProgress: () => undefined,
        setProgress: () => undefined,
      },
      networkClient,
      actorSourceProvider,
      logger: loggerService.getLogger("EmbyActorPhoto"),
    }),
    embyActorInfoService: new EmbyActorInfoService({
      signalService: {
        showLogText: (message, level) => signalService.showLogText(message, level),
        resetProgress: () => undefined,
        setProgress: () => undefined,
      },
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
    updateService: new UpdateService(signalService),
    shutdown: async () => {
      let firstError: unknown;
      for (const shutdown of [
        async () => await scraperService.shutdown(),
        async () => await maintenanceService.shutdown(),
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
