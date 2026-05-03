import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, DownloadedAssets, FileInfo, NfoLocalState, VideoMeta } from "@mdcz/shared/types";
import type { RuntimeActorImageService } from "../scrape/actorOutput";
import type { ImageAlternatives, SourceMap } from "../scrape/aggregation";
import type { DownloadCallbacks, DownloadManager } from "../scrape/download";
import type { FileOrganizer, OrganizePlan } from "../scrape/FileOrganizer";
import type { NfoGenerator } from "../scrape/nfo";
import { reconcileExistingNfoFiles } from "../scrape/nfo";
import { prepareCrawlerDataForMovieOutput } from "../scrape/output/prepareCrawlerDataForMovieOutput";
import { prepareImageAlternativesForDownload } from "../scrape/output/prepareImageAlternativesForDownload";
import { pathExists } from "../scrape/utils/filesystem";
import { buildMovieTags } from "./movieTags";

export interface ScrapeProgressState {
  fileIndex: number;
  totalFiles: number;
}

export interface MaintenanceSignalService {
  setProgress(value: number, current: number, total: number): void;
  showLogText(message: string): void;
}

export const updateScrapeProgress = (
  signalService: Pick<MaintenanceSignalService, "setProgress">,
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

export async function prepareOutputCrawlerData(input: {
  actorImageService: RuntimeActorImageService;
  actorSourceProvider?: unknown;
  config: Configuration;
  crawlerData: CrawlerData | undefined;
  enabled: boolean;
  movieDir?: string;
  signal?: AbortSignal;
  sourceVideoPath: string;
}): Promise<{ actorPhotoPaths: string[]; data: CrawlerData | undefined }> {
  if (!input.crawlerData) {
    return { data: input.crawlerData, actorPhotoPaths: [] };
  }
  return await prepareCrawlerDataForMovieOutput(input.actorImageService, input.config, input.crawlerData, {
    actorSourceProvider: input.actorSourceProvider,
    enabled: input.enabled,
    movieDir: input.movieDir,
    signal: input.signal,
    sourceVideoPath: input.sourceVideoPath,
  });
}

export const downloadCrawlerAssets = async (input: {
  callbacks?: DownloadCallbacks;
  config: Configuration;
  crawlerData: CrawlerData;
  downloadManager: DownloadManager;
  fileInfo: FileInfo;
  imageAlternatives?: Partial<ImageAlternatives>;
  outputDir: string;
  signalService: Pick<MaintenanceSignalService, "showLogText">;
  sources?: Pick<SourceMap, "thumb_url" | "poster_url" | "scene_images">;
}): Promise<DownloadedAssets> => {
  input.signalService.showLogText(`[${input.fileInfo.number}] Downloading resources...`);
  const preparedImageAlternatives = prepareImageAlternativesForDownload(
    input.crawlerData,
    input.imageAlternatives,
    input.sources,
  );
  return await input.downloadManager.downloadAll(
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
  );
};

export const writePreparedNfo = async (input: {
  assets: DownloadedAssets;
  config: Pick<Configuration, "download" | "naming">;
  crawlerData: CrawlerData | undefined;
  enabled: boolean;
  fileInfo: FileInfo;
  keepExisting?: boolean;
  localState?: NfoLocalState;
  nfoGenerator: NfoGenerator;
  nfoPath?: string;
  signalService?: Pick<MaintenanceSignalService, "showLogText">;
  sourceVideoPath: string;
  sources?: SourceMap;
  startLogLabel?: string;
  videoMeta?: VideoMeta;
}): Promise<string | undefined> => {
  if (!(input.enabled && input.crawlerData && input.nfoPath)) return undefined;
  if (input.startLogLabel && input.signalService) input.signalService.showLogText(input.startLogLabel);
  if (input.keepExisting) {
    const existingNfoPath = await reconcileExistingNfoFiles(input.nfoPath, input.config.download.nfoNaming, pathExists);
    if (existingNfoPath) return existingNfoPath;
  }
  return await input.nfoGenerator.writeNfo(input.nfoPath, input.crawlerData, {
    assets: input.assets,
    fileInfo: input.fileInfo,
    localState: input.localState,
    buildTags: buildMovieTags,
    nfoNaming: input.config.download.nfoNaming,
    nfoTitleTemplate: input.config.naming.nfoTitleTemplate,
    sources: input.sources,
    videoMeta: input.videoMeta,
  });
};

export const organizePreparedVideo = async (input: {
  config: Configuration;
  enabled: boolean;
  fileInfo: FileInfo;
  fileOrganizer: FileOrganizer;
  plan?: OrganizePlan;
  signalService?: Pick<MaintenanceSignalService, "showLogText">;
  startLogLabel?: string;
}): Promise<string> => {
  if (!(input.enabled && input.plan)) return input.fileInfo.filePath;
  if (input.startLogLabel && input.signalService) input.signalService.showLogText(input.startLogLabel);
  return await input.fileOrganizer.organizeVideo(input.fileInfo, input.plan, input.config);
};
