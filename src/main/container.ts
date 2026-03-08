import type { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import type { JellyfinActorInfoService, JellyfinActorPhotoService } from "@main/services/jellyfin";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import type { ScraperService } from "@main/services/scraper";
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
  crawlerProvider: CrawlerProvider;
  actorPhotoService: JellyfinActorPhotoService;
  actorInfoService: JellyfinActorInfoService;
  symlinkService: SymlinkService;
  amazonPosterToolService: AmazonPosterToolService;
}
