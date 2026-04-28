import type { ServiceContainer } from "@main/container";
import { ActorImageService } from "@main/services/ActorImageService";
import {
  ActorSourceProvider,
  ActorSourceRegistry,
  AvbaseActorSource,
  AvjohoActorSource,
  GfriendsActorSource,
  LocalActorSource,
  OfficialActorSource,
} from "@main/services/actorSource";
import { createImageHostCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import { RecentAcquisitionsStore } from "@main/services/history";
import { OutputLibraryScanner } from "@main/services/library";
import { EmbyActorInfoService, EmbyActorPhotoService } from "@main/services/mediaServer/emby";
import { JellyfinActorInfoService, JellyfinActorPhotoService } from "@main/services/mediaServer/jellyfin";
import { createElectronCookieResolver, type NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { ScraperService } from "@main/services/scraper";
import { AmazonJpImageService } from "@main/services/scraper/AmazonJpImageService";
import { MaintenanceService } from "@main/services/scraper/maintenance/MaintenanceService";
import { AmazonPosterToolService, BatchTranslateToolService, SymlinkService } from "@main/services/tools";
import type { WindowService } from "@main/services/WindowService";

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
    siteRequestConfigRegistrar: networkClient,
  });
  const imageHostCooldownStore = createImageHostCooldownStore();
  const recentAcquisitionsStore = new RecentAcquisitionsStore();
  const outputLibraryScanner = new OutputLibraryScanner();
  const amazonJpImageService = new AmazonJpImageService(networkClient);
  const actorImageService = new ActorImageService({ networkClient });
  const avjohoCookieResolver = createElectronCookieResolver({
    expectedCookieNames: ["wsidchk"],
  });
  const actorSourceProvider = new ActorSourceProvider({
    registry: new ActorSourceRegistry([
      new LocalActorSource(actorImageService),
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
    recentAcquisitionsStore,
    outputLibraryScanner,
  );
  const maintenanceService = new MaintenanceService(
    signalService,
    networkClient,
    crawlerProvider,
    actorImageService,
    actorSourceProvider,
    imageHostCooldownStore,
  );

  return {
    signalService,
    windowService,
    networkClient,
    fetchGateway,
    recentAcquisitionsStore,
    outputLibraryScanner,
    scraperService,
    maintenanceService,
    crawlerProvider,
    actorSourceProvider,
    actorImageService,
    jellyfinActorPhotoService: new JellyfinActorPhotoService({
      signalService,
      networkClient,
      actorSourceProvider,
    }),
    jellyfinActorInfoService: new JellyfinActorInfoService({
      signalService,
      networkClient,
      actorSourceProvider,
    }),
    embyActorPhotoService: new EmbyActorPhotoService({
      signalService,
      networkClient,
      actorSourceProvider,
    }),
    embyActorInfoService: new EmbyActorInfoService({
      signalService,
      networkClient,
      actorSourceProvider,
    }),
    symlinkService: new SymlinkService({ signalService }),
    amazonPosterToolService: new AmazonPosterToolService(networkClient, amazonJpImageService),
    batchTranslateToolService: new BatchTranslateToolService(networkClient),
    shutdown: async () => {
      await Promise.allSettled([scraperService.shutdown(), maintenanceService.shutdown(), crawlerProvider.shutdown()]);
    },
  };
};
