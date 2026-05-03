import type { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import type { SignalService } from "@main/services/SignalService";
import { toErrorMessage } from "@main/utils/common";
import { resolvePosterBadgeDefinitions } from "@main/utils/movieTags";
import { probeVideoMetadata } from "@main/utils/video";
import type { FileOrganizer, OrganizePlan } from "@mdcz/runtime/scrape";
import { prepareCrawlerDataForMovieOutput, prepareImageAlternativesForDownload } from "@mdcz/runtime/scrape";
import type { CrawlerData, DownloadedAssets, FileInfo, NfoLocalState, VideoMeta } from "@mdcz/shared/types";
import type { Logger } from "winston";
import { throwIfAborted } from "../abort";
import type { ImageAlternatives, SourceMap } from "../aggregation";
import type { DownloadCallbacks, DownloadManager } from "../DownloadManager";
import type { NfoGenerator } from "../NfoGenerator";
import { reconcileExistingNfoFiles } from "../NfoGenerator";
import { PosterWatermarkService } from "../PosterWatermarkService";

export {
  prepareCrawlerDataForMovieOutput,
  prepareCrawlerDataForNfo,
  prepareImageAlternativesForDownload,
} from "@mdcz/runtime/scrape";

const posterWatermarkService = new PosterWatermarkService();

export interface ScrapeProgressState {
  fileIndex: number;
  totalFiles: number;
}

export const updateScrapeProgress = (
  signalService: Pick<SignalService, "setProgress">,
  progress: ScrapeProgressState,
  stepPercent: number,
): void => {
  const normalizedPercent = Math.max(0, Math.min(100, stepPercent));
  const fileIndex = Math.max(1, progress.fileIndex);
  const totalFiles = Math.max(1, progress.totalFiles);
  const globalValue = (fileIndex - 1 + normalizedPercent / 100) / totalFiles;
  const value = Math.max(0, Math.min(100, Math.round(globalValue * 100)));

  signalService.setProgress(value, fileIndex, totalFiles);
};

export function prepareOutputCrawlerData(input: {
  actorImageService: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  config: Configuration;
  crawlerData: CrawlerData;
  enabled: boolean;
  movieDir?: string;
  signal?: AbortSignal;
  sourceVideoPath: string;
}): Promise<{ actorPhotoPaths: string[]; data: CrawlerData }>;
export function prepareOutputCrawlerData(input: {
  actorImageService: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  config: Configuration;
  crawlerData: CrawlerData | undefined;
  enabled: boolean;
  movieDir?: string;
  signal?: AbortSignal;
  sourceVideoPath: string;
}): Promise<{ actorPhotoPaths: string[]; data: CrawlerData | undefined }>;
export async function prepareOutputCrawlerData(input: {
  actorImageService: ActorImageService;
  actorSourceProvider?: ActorSourceProvider;
  config: Configuration;
  crawlerData: CrawlerData | undefined;
  enabled: boolean;
  movieDir?: string;
  signal?: AbortSignal;
  sourceVideoPath: string;
}): Promise<{ actorPhotoPaths: string[]; data: CrawlerData | undefined }> {
  if (!input.crawlerData) {
    return {
      data: input.crawlerData,
      actorPhotoPaths: [],
    };
  }

  return await prepareCrawlerDataForMovieOutput(input.actorImageService, input.config, input.crawlerData, {
    enabled: input.enabled,
    movieDir: input.movieDir,
    sourceVideoPath: input.sourceVideoPath,
    actorSourceProvider: input.actorSourceProvider,
    signal: input.signal,
  });
}

export const applyPosterTagBadgesIfNeeded = async (input: {
  assets: DownloadedAssets;
  config: Pick<Configuration, "download">;
  crawlerData: CrawlerData;
  fileInfo: FileInfo;
  localState?: NfoLocalState;
  logger: Pick<Logger, "warn">;
  signal?: AbortSignal;
  signalService?: Pick<SignalService, "showLogText">;
  watermarkService?: Pick<PosterWatermarkService, "applyTagBadges">;
}): Promise<DownloadedAssets> => {
  if (!input.config.download.tagBadges) {
    return input.assets;
  }

  const posterPath = input.assets.poster;
  if (!posterPath || !input.assets.downloaded.includes(posterPath)) {
    return input.assets;
  }

  const badges = resolvePosterBadgeDefinitions(
    input.crawlerData,
    input.fileInfo,
    input.localState,
    input.config.download.tagBadgeTypes,
  );
  if (badges.length === 0) {
    return input.assets;
  }

  throwIfAborted(input.signal);
  input.signalService?.showLogText(`[${input.fileInfo.number}] Applying poster tag badges...`);

  try {
    await (input.watermarkService ?? posterWatermarkService).applyTagBadges(
      posterPath,
      badges,
      input.config.download.tagBadgePosition,
      {
        imageOverrides: input.config.download.tagBadgeImageOverrides,
        onWarn: (message) => input.logger.warn(message),
      },
    );
  } catch (error) {
    input.logger.warn(`Failed to apply poster tag badges for ${posterPath}: ${toErrorMessage(error)}`);
  }

  throwIfAborted(input.signal);
  return input.assets;
};

export const downloadCrawlerAssets = async (input: {
  callbacks?: DownloadCallbacks;
  config: Configuration;
  crawlerData: CrawlerData;
  downloadManager: DownloadManager;
  fileInfo: FileInfo;
  imageAlternatives?: Partial<ImageAlternatives>;
  localState?: NfoLocalState;
  logger: Pick<Logger, "warn">;
  movieBaseName?: string;
  outputDir: string;
  signalService: Pick<SignalService, "showLogText">;
  sources?: Pick<SourceMap, "thumb_url" | "poster_url" | "scene_images">;
}): Promise<DownloadedAssets> => {
  input.signalService.showLogText(`[${input.fileInfo.number}] Downloading resources...`);
  const preparedImageAlternatives = prepareImageAlternativesForDownload(
    input.crawlerData,
    input.imageAlternatives,
    input.sources,
  );

  const assets = await input.downloadManager.downloadAll(
    input.outputDir,
    input.crawlerData,
    input.config,
    preparedImageAlternatives,
    {
      ...input.callbacks,
      onSceneProgress: (downloaded, total) => {
        input.signalService.showLogText(`[${input.fileInfo.number}] Scene images: ${downloaded}/${total}`);
        input.callbacks?.onSceneProgress?.(downloaded, total);
      },
    },
    {
      movieBaseName: input.movieBaseName,
    },
  );

  return await applyPosterTagBadgesIfNeeded({
    assets,
    config: input.config,
    crawlerData: input.crawlerData,
    fileInfo: input.fileInfo,
    localState: input.localState,
    logger: input.logger,
    signal: input.callbacks?.signal,
    signalService: input.signalService,
  });
};

export const applyResolvedSceneImageMetadata = (
  crawlerData: CrawlerData,
  sceneImageUrls: string[] | undefined,
): CrawlerData => {
  if (sceneImageUrls === undefined) {
    return crawlerData;
  }

  return {
    ...crawlerData,
    scene_images: [...sceneImageUrls],
  };
};

export const probeVideoMetadataOrWarn = async (input: {
  logger: Pick<Logger, "warn">;
  sourceVideoPath: string;
  warningPrefix: string;
}): Promise<VideoMeta | undefined> => {
  try {
    return await probeVideoMetadata(input.sourceVideoPath);
  } catch (error) {
    const message = toErrorMessage(error);
    input.logger.warn(`${input.warningPrefix}: ${message}`);
    return undefined;
  }
};

export const writePreparedNfo = async (input: {
  assets: DownloadedAssets;
  config: Pick<Configuration, "download" | "naming">;
  crawlerData: CrawlerData | undefined;
  enabled: boolean;
  fileInfo: FileInfo;
  keepExisting?: boolean;
  localState?: NfoLocalState;
  logger: Pick<Logger, "warn">;
  nfoGenerator: NfoGenerator;
  nfoPath?: string;
  signalService?: Pick<SignalService, "showLogText">;
  sourceVideoPath: string;
  sources?: SourceMap;
  startLogLabel?: string;
  videoMeta?: VideoMeta;
}): Promise<string | undefined> => {
  if (!(input.enabled && input.crawlerData && input.nfoPath)) {
    return undefined;
  }

  if (input.startLogLabel && input.signalService) {
    input.signalService.showLogText(input.startLogLabel);
  }

  if (input.keepExisting) {
    const existingNfoPath = await reconcileExistingNfoFiles(input.nfoPath, input.config.download.nfoNaming);
    if (existingNfoPath) {
      return existingNfoPath;
    }
  }

  const videoMeta =
    input.videoMeta ??
    (await probeVideoMetadataOrWarn({
      logger: input.logger,
      sourceVideoPath: input.sourceVideoPath,
      warningPrefix: `Video probe failed for ${input.sourceVideoPath}`,
    }));

  return await input.nfoGenerator.writeNfo(input.nfoPath, input.crawlerData, {
    assets: input.assets,
    sources: input.sources,
    videoMeta,
    fileInfo: input.fileInfo,
    localState: input.localState,
    nfoNaming: input.config.download.nfoNaming,
    nfoTitleTemplate: input.config.naming.nfoTitleTemplate,
  });
};

export const organizePreparedVideo = async (input: {
  config: Configuration;
  enabled: boolean;
  fileInfo: FileInfo;
  fileOrganizer: FileOrganizer;
  plan?: OrganizePlan;
  signalService?: Pick<SignalService, "showLogText">;
  startLogLabel?: string;
}): Promise<string> => {
  if (!(input.enabled && input.plan)) {
    return input.fileInfo.filePath;
  }

  if (input.startLogLabel && input.signalService) {
    input.signalService.showLogText(input.startLogLabel);
  }

  return await input.fileOrganizer.organizeVideo(input.fileInfo, input.plan, input.config);
};
