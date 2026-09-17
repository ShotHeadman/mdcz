import { dirname } from "node:path";
import { getActorImageCacheDirectory } from "@main/appIdentity";
import { type Configuration, configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { createMediaRoot, deterministicMediaRootId } from "@mdcz/media-store";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import { LocalScanService } from "@mdcz/runtime/maintenance";
import type { PublicationOutputPort } from "@mdcz/runtime/publication";
import type { DownloadManager, NfoGenerator } from "@mdcz/runtime/scrape";
import {
  ActorImageService,
  type AggregationService,
  FileOrganizer,
  FileScraper,
  type NfoOptions,
  type RuntimeScrapeSignalService,
  type TranslateService,
} from "@mdcz/runtime/scrape";
import { applyDesktopPosterTagBadges, probeVideoMetadataOrWarn } from "./output";

export const fileOrganizer = new FileOrganizer(loggerService.getLogger("FileOrganizer"));

export interface FileScraperDependencies {
  outputs?: PublicationOutputPort;
  aggregationService: AggregationService;
  translateService: TranslateService;
  nfoGenerator: NfoGenerator;
  buildTags?: NfoOptions["buildTags"];
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  signalService?: RuntimeScrapeSignalService;
  actorImageService?: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  localScanService?: Pick<LocalScanService, "scanVideo">;
  getConfiguration?: () => Promise<Configuration>;
}

export const createFileScraper = (
  deps: FileScraperDependencies,
  options: { mode?: "single" | "batch"; scrapeSessionId?: string } = {},
): FileScraper => {
  const logger = loggerService.getLogger("FileScraper");
  const actorImageService =
    deps.actorImageService ??
    new ActorImageService({
      cacheRoot: getActorImageCacheDirectory(),
      logger,
    });
  const localScanService = deps.localScanService ?? new LocalScanService();
  const signalService = deps.signalService ?? {
    showLogText: () => undefined,
    setProgress: () => undefined,
    showScrapeInfo: () => undefined,
    showFailedInfo: () => undefined,
  };
  return new FileScraper(
    {
      ...deps,
      signalService,
      actorImageService,
      getConfiguration: deps.getConfiguration ?? (async () => await configManager.getValidated()),
      logger,
      loadExistingNfoLocalState: async (filePath, configuration) => {
        if (!configuration.download.generateNfo || !configuration.download.keepNfo) return undefined;
        try {
          const root = createMediaRoot({
            id: deterministicMediaRootId(dirname(filePath)),
            displayName: dirname(filePath),
            hostPath: dirname(filePath),
          });
          return (await localScanService.scanVideo(root, filePath, configuration.paths.sceneImagesFolder))
            .nfoLocalState;
        } catch (error) {
          logger.warn(`Failed to read existing NFO local state for ${filePath}: ${toErrorMessage(error)}`);
          return undefined;
        }
      },
      postProcessAssets: async ({ assets, configuration, crawlerData, fileInfo, localState, signal }) =>
        await applyDesktopPosterTagBadges({
          assets,
          config: configuration,
          crawlerData,
          fileInfo,
          localState,
          logger,
          signal,
          signalService: deps.signalService,
        }),
      probeVideoMetadata: async (sourceVideoPath) =>
        await probeVideoMetadataOrWarn({ logger, sourceVideoPath, warningPrefix: "Video probe failed" }),
    },
    options,
  );
};
