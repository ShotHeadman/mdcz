import type { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import type { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import type { EmbyActorInfoService, EmbyActorPhotoService } from "@main/services/emby";
import type { JellyfinActorInfoService, JellyfinActorPhotoService } from "@main/services/jellyfin";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import type { ScraperService } from "@main/services/scraper";
import type { MaintenanceService } from "@main/services/scraper/maintenance/MaintenanceService";
import type { AmazonPosterToolService, SymlinkService } from "@main/services/tools";
import type { WindowService } from "@main/services/WindowService";

/**
 * Centralized service container for the main process.
 *
 * All long-lived services are created once at bootstrap and passed to
 * IPC handlers via this container. Module-level singletons like
 * `configManager`, `loggerService`, and `rateLimiter` remain as
 * direct imports since they have no constructor dependencies.
 */
export interface ServiceContainer {
  signalService: SignalService;
  windowService: WindowService;
  networkClient: NetworkClient;
  fetchGateway: FetchGateway;
  scraperService: ScraperService;
  maintenanceService: MaintenanceService;
  crawlerProvider: CrawlerProvider;
  actorSourceProvider: ActorSourceProvider;
  actorImageService: ActorImageService;
  jellyfinActorPhotoService: JellyfinActorPhotoService;
  jellyfinActorInfoService: JellyfinActorInfoService;
  embyActorPhotoService: EmbyActorPhotoService;
  embyActorInfoService: EmbyActorInfoService;
  symlinkService: SymlinkService;
  amazonPosterToolService: AmazonPosterToolService;
}
