import type { Configuration } from "@mdcz/shared/config";
import type {
  CrawlerData,
  DiscoveredAssets,
  DownloadedAssets,
  FileInfo,
  NfoLocalState,
  VideoMeta,
} from "@mdcz/shared/types";
import type { RuntimeActorImageService, RuntimeActorSourceProvider } from "../actorOutput";
import type { ImageAlternatives, SourceMap } from "../aggregation";
import type { DirectoryInventory } from "../DirectoryInventory";
import type { DownloadCallbacks, DownloadManager } from "../download";
import { type NfoGenerator, type NfoOptions, nfoIgnoreFieldsToEnabledFields } from "../nfo";
import { prepareCrawlerDataForMovieOutput } from "./prepareCrawlerDataForMovieOutput";
import { prepareImageAlternativesForDownload } from "./prepareImageAlternativesForDownload";

export const reportItemProgress = (
  sink: { setProgress(value: number, current: number, total: number): void },
  progress: { fileIndex: number; totalFiles: number },
  stepPercent: number,
): void => {
  const normalizedPercent = Math.max(0, Math.min(100, stepPercent));
  const fileIndex = Math.max(1, progress.fileIndex);
  const totalFiles = Math.max(1, progress.totalFiles);
  sink.setProgress(normalizedPercent, fileIndex, totalFiles);
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
  existingAssets?: DiscoveredAssets;
  inventory?: DirectoryInventory;
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
  let derivedPosterSource: string | undefined;
  const assets = await input.downloadManager.downloadAll(
    input.outputDir,
    input.crawlerData,
    input.config,
    preparedImageAlternatives,
    {
      ...input.callbacks,
      onDerivedPosterSource: (url) => {
        derivedPosterSource = url;
        input.callbacks?.onDerivedPosterSource?.(url);
      },
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
      existingAssets: input.existingAssets,
      inventory: input.inventory,
    },
  );
  const crawlerData = {
    ...input.crawlerData,
    ...(resolvedSceneImageUrls === undefined ? {} : { scene_images: [...resolvedSceneImageUrls] }),
    ...(derivedPosterSource === undefined ? {} : { poster_source_url: derivedPosterSource }),
  };
  const processedAssets = input.postProcessAssets ? await input.postProcessAssets(assets, crawlerData) : assets;

  return { assets: processedAssets, crawlerData };
};

export const writePreparedNfo = async (input: {
  assets: DownloadedAssets;
  config: Pick<Configuration, "download" | "naming">;
  crawlerData?: CrawlerData;
  enabled: boolean;
  fileInfo: FileInfo;
  nfoGenerator: Pick<NfoGenerator, "writeNfo">;
  nfoPath?: string;
  sourceVideoPath: string;
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
