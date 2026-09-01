import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, DownloadedAssets, FileInfo, NfoLocalState, VideoMeta } from "@mdcz/shared/types";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "../actorOutput";
import type { ImageAlternatives, SourceMap } from "../aggregation";
import type { DownloadCallbacks, DownloadManager } from "../download";
import type { OrganizePlan } from "../FileOrganizer";
import { type NfoGenerator, type NfoOptions, nfoIgnoreFieldsToEnabledFields, reconcileExistingNfoFiles } from "../nfo";
import { pathExists } from "../utils/filesystem";
import { prepareCrawlerDataForMovieOutput } from "./prepareCrawlerDataForMovieOutput";
import { prepareImageAlternativesForDownload } from "./prepareImageAlternativesForDownload";

export const updateBatchProgress = (
  sink: { setProgress(value: number, current: number, total: number): void },
  progress: { fileIndex: number; totalFiles: number },
  stepPercent: number,
): void => {
  const normalizedPercent = Math.max(0, Math.min(100, stepPercent));
  const fileIndex = Math.max(1, progress.fileIndex);
  const totalFiles = Math.max(1, progress.totalFiles);
  const globalValue = (fileIndex - 1 + normalizedPercent / 100) / totalFiles;
  const value = Math.max(0, Math.min(100, Math.round(globalValue * 100)));

  sink.setProgress(value, fileIndex, totalFiles);
};

export const prepareOutputCrawlerData = async (input: {
  actorImageService: RuntimeActorImageService;
  actorSourceProvider?: RuntimeActorSourceProvider;
  config: Configuration;
  crawlerData?: CrawlerData;
  enabled: boolean;
  movieDir?: string;
  sourceVideoPath: string;
  signal?: AbortSignal;
}): Promise<{ data?: CrawlerData; actorPhotoPaths: string[] }> => {
  if (!input.crawlerData) {
    return { data: undefined, actorPhotoPaths: [] };
  }

  return await prepareCrawlerDataForMovieOutput(input.actorImageService, input.config, input.crawlerData, {
    actorSourceProvider: input.actorSourceProvider,
    enabled: input.enabled,
    movieDir: input.movieDir,
    signal: input.signal,
    sourceVideoPath: input.sourceVideoPath,
  });
};

export const downloadCrawlerAssets = async (input: {
  config: Configuration;
  crawlerData: CrawlerData;
  downloadManager: DownloadManager;
  fileInfo: FileInfo;
  outputDir: string;
  existingAssetDir?: string;
  imageAlternatives?: Partial<ImageAlternatives>;
  sources?: Pick<SourceMap, "thumb_url" | "poster_url" | "scene_images">;
  callbacks?: DownloadCallbacks;
  movieBaseName?: string;
  onLog?: (message: string) => void;
  postProcessAssets?: (assets: DownloadedAssets, crawlerData: CrawlerData) => Promise<DownloadedAssets>;
}): Promise<{ assets: DownloadedAssets; crawlerData: CrawlerData }> => {
  input.onLog?.(`[${input.fileInfo.number}] Downloading resources...`);
  const preparedImageAlternatives = prepareImageAlternativesForDownload(
    input.crawlerData,
    input.imageAlternatives,
    input.sources,
  );
  let resolvedSceneImageUrls: string[] | undefined;
  const assets = await input.downloadManager.downloadAll(
    input.outputDir,
    input.crawlerData,
    input.config,
    preparedImageAlternatives,
    {
      ...input.callbacks,
      onResolvedSceneImageUrls: (urls) => {
        resolvedSceneImageUrls = urls;
        input.callbacks?.onResolvedSceneImageUrls?.(urls);
      },
      onSceneProgress: (downloaded, total) => {
        input.onLog?.(`[${input.fileInfo.number}] Scene images: ${downloaded}/${total}`);
        input.callbacks?.onSceneProgress?.(downloaded, total);
      },
    },
    {
      movieBaseName: input.movieBaseName,
      existingAssetDir: input.existingAssetDir,
    },
  );
  const crawlerData =
    resolvedSceneImageUrls === undefined
      ? input.crawlerData
      : { ...input.crawlerData, scene_images: [...resolvedSceneImageUrls] };
  const processedAssets = input.postProcessAssets ? await input.postProcessAssets(assets, crawlerData) : assets;

  return { assets: processedAssets, crawlerData };
};

export const writePreparedNfo = async (input: {
  assets: DownloadedAssets;
  config: Pick<Configuration, "download" | "naming">;
  crawlerData?: CrawlerData;
  enabled: boolean;
  fileInfo: FileInfo;
  nfoGenerator: NfoGenerator;
  nfoPath?: string;
  sourceVideoPath: string;
  keepExisting?: boolean;
  localState?: NfoLocalState;
  sources?: SourceMap;
  videoMeta?: VideoMeta;
  buildTags?: NfoOptions["buildTags"];
  probeVideoMetadata?: (sourcePath: string) => Promise<VideoMeta | undefined>;
  onLog?: (message: string) => void;
  startLogLabel?: string;
  writeFile?: (path: string, content: string) => Promise<void>;
}): Promise<string | undefined> => {
  if (!(input.enabled && input.crawlerData && input.nfoPath)) {
    return undefined;
  }

  if (input.startLogLabel) {
    input.onLog?.(input.startLogLabel);
  }

  if (input.keepExisting) {
    const existingNfoPath = await reconcileExistingNfoFiles(input.nfoPath, input.config.download.nfoNaming, pathExists);
    if (existingNfoPath) {
      return existingNfoPath;
    }
  }

  const videoMeta = input.videoMeta ?? (await input.probeVideoMetadata?.(input.sourceVideoPath));
  return await input.nfoGenerator.writeNfo(input.nfoPath, input.crawlerData, {
    assets: input.assets,
    buildTags: input.buildTags,
    enabledFields: nfoIgnoreFieldsToEnabledFields(input.config.download.nfoIgnoreFields),
    includeRemoteSceneImageUrls: input.config.download.downloadSceneImages,
    allowRemoteTrailerFallback: input.config.download.downloadTrailer,
    fileInfo: input.fileInfo,
    localState: input.localState,
    nfoNaming: input.config.download.nfoNaming,
    nfoTitleTemplate: input.config.naming.nfoTitleTemplate,
    sources: input.sources,
    videoMeta,
    writeFile: input.writeFile,
  });
};

export const organizePreparedVideo = async (input: {
  enabled: boolean;
  fileInfo: FileInfo;
  plan?: OrganizePlan;
  onLog?: (message: string) => void;
  startLogLabel?: string;
}): Promise<string> => {
  if (!(input.enabled && input.plan)) {
    return input.fileInfo.filePath;
  }

  if (input.startLogLabel) {
    input.onLog?.(input.startLogLabel);
  }

  return input.plan.targetVideoPath;
};
