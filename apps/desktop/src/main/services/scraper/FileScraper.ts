import { ActorImageService } from "@main/services/ActorImageService";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { SignalService } from "@main/services/SignalService";
import { toErrorMessage } from "@main/utils/common";
import type { ActorSourceProvider } from "@mdcz/runtime/actorSource";
import { LocalScanService } from "@mdcz/runtime/maintenance";
import { type AggregationService, type FileOrganizer, FileScraper, type TranslateService } from "@mdcz/runtime/scrape";
import type { DownloadManager } from "./DownloadManager";
import type { NfoGenerator } from "./NfoGenerator";
import { applyDesktopPosterTagBadges, probeVideoMetadataOrWarn } from "./output";

export {
  type FileScrapeOptions,
  type FileScrapeProgress,
  FileScraper,
  type ScrapeExecutionMode,
} from "@mdcz/runtime/scrape";

export interface FileScraperDependencies {
  aggregationService: AggregationService;
  translateService: TranslateService;
  nfoGenerator: NfoGenerator;
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  signalService: Pick<
    SignalService,
    "setProgress" | "showFailedInfo" | "showLogText" | "showScrapeInfo" | "showScrapeResult"
  >;
  actorImageService?: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  localScanService?: Pick<LocalScanService, "scanVideo">;
}

export const createFileScraper = (
  deps: FileScraperDependencies,
  options: { mode?: "single" | "batch"; scrapeSessionId?: string } = {},
): FileScraper => {
  const logger = loggerService.getLogger("FileScraper");
  const actorImageService = deps.actorImageService ?? new ActorImageService();
  const localScanService = deps.localScanService ?? new LocalScanService();
  return new FileScraper(
    {
      ...deps,
      actorImageService,
      getConfiguration: async () => await configManager.getValidated(),
      logger,
      loadExistingNfoLocalState: async (filePath, configuration) => {
        if (!configuration.download.generateNfo || !configuration.download.keepNfo) return undefined;
        try {
          return (await localScanService.scanVideo(filePath, configuration.paths.sceneImagesFolder)).nfoLocalState;
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
