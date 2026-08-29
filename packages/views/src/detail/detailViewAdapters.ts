import { type AssetRef, type RootFileRef, toLocalFileUrl } from "@mdcz/shared/mediaRef";
import type { ScrapeResultDto } from "@mdcz/shared/serverDtos";
import type {
  CrawlerData,
  DiscoveredAssets,
  LocalScanEntry,
  MaintenanceItemResult,
  MaintenancePreviewItem,
  ScrapeResult,
  VideoMeta,
} from "@mdcz/shared/types";
import type { DetailViewItem } from "./types";

type DetailAssetSources = Pick<DiscoveredAssets, "poster" | "thumb" | "fanart" | "sceneImages" | "trailer">;

const assetSource = (assets: readonly AssetRef[], kind: string): string | undefined => {
  const local = assets.find((asset) => asset.type === "local" && asset.kind === kind);
  if (local?.type === "local") return toLocalFileUrl(local.file);
  const remote = assets.find((asset) => asset.type === "remote" && asset.kind === kind);
  return remote?.type === "remote" ? remote.url : undefined;
};

const toAssetSources = (assets: readonly AssetRef[]): DetailAssetSources => ({
  poster: assetSource(assets, "poster"),
  thumb: assetSource(assets, "thumb"),
  fanart: assetSource(assets, "fanart"),
  trailer: assetSource(assets, "trailer"),
  sceneImages: assets.flatMap((asset) =>
    asset.kind !== "scene" ? [] : [asset.type === "local" ? toLocalFileUrl(asset.file) : asset.url],
  ),
});

const getDirectoryPath = (filePath: string): string => {
  const normalized = filePath.replace(/[\\/]+$/u, "");
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : "";
};

export const formatDuration = (durationSeconds: number | undefined): string | undefined => {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }

  const totalSeconds = Math.round(durationSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const formatBitrate = (bitrateBps: number | undefined): string | undefined => {
  if (typeof bitrateBps !== "number" || !Number.isFinite(bitrateBps) || bitrateBps <= 0) {
    return undefined;
  }

  return `${(bitrateBps / 1_000_000).toFixed(1)} Mbps`;
};

export const normalizeDetailOutlineText = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return value
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:div|p)>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
};

const toDetailStatus = (
  status: ScrapeResult["status"] | MaintenanceItemResult["status"] | MaintenancePreviewItem["status"] | undefined,
): DetailViewItem["status"] => {
  if (status === "processing" || status === "pending") {
    return "processing";
  }

  return status === "failed" || status === "blocked" || status === "skipped" ? "failed" : "success";
};

const formatResolution = (
  videoMeta: VideoMeta | undefined,
  fallbackResolution: string | undefined,
): string | undefined => {
  if (videoMeta && videoMeta.width > 0 && videoMeta.height > 0) {
    return `${videoMeta.width}x${videoMeta.height}`;
  }

  return fallbackResolution;
};

const resolveArtworkUrls = (crawlerData: CrawlerData | undefined, assets: DetailAssetSources | undefined) => ({
  posterUrl: assets?.poster ?? crawlerData?.poster_url,
  thumbUrl: assets?.thumb ?? assets?.fanart ?? crawlerData?.thumb_url ?? crawlerData?.fanart_url,
  fanartUrl: assets?.fanart ?? assets?.thumb ?? crawlerData?.fanart_url ?? crawlerData?.thumb_url,
});

const resolveSceneImages = (
  crawlerData: CrawlerData | undefined,
  sceneImages: string[] | undefined,
): string[] | undefined => {
  if (sceneImages && sceneImages.length > 0) {
    return sceneImages;
  }

  return crawlerData?.scene_images;
};

const buildDetailViewMetadata = (input: {
  crawlerData?: CrawlerData;
  videoMeta?: VideoMeta;
  resolution?: string;
  assets?: DetailAssetSources;
}) => {
  const { crawlerData, videoMeta, resolution, assets } = input;

  return {
    title: crawlerData?.title_zh ?? crawlerData?.title,
    actors: crawlerData?.actors,
    plot: normalizeDetailOutlineText(crawlerData?.plot_zh ?? crawlerData?.plot),
    genres: crawlerData?.genres,
    releaseDate: crawlerData?.release_date,
    durationSeconds: videoMeta?.durationSeconds ?? crawlerData?.durationSeconds,
    resolution: formatResolution(videoMeta, resolution),
    bitrate: videoMeta?.bitrate,
    director: crawlerData?.director,
    series: crawlerData?.series,
    studio: crawlerData?.studio,
    publisher: crawlerData?.publisher,
    rating: crawlerData?.rating,
    ...resolveArtworkUrls(crawlerData, assets),
    sceneImages: resolveSceneImages(crawlerData, assets?.sceneImages),
    trailerUrl: assets?.trailer ?? crawlerData?.trailer_url,
  };
};

export const getScrapeResultTitle = (result: ScrapeResult): string | undefined =>
  result.crawlerData?.title_zh ?? result.crawlerData?.title;

export const getMaintenanceDetailTitle = (entry: LocalScanEntry) =>
  entry.crawlerData?.title_zh ?? entry.crawlerData?.title ?? entry.fileInfo.fileName;

export const toDetailViewItemFromScrapeResult = (result: ScrapeResult): DetailViewItem => {
  const fileRef: RootFileRef = result.output ?? { rootId: result.rootId, relativePath: result.relativePath };
  return {
    resultId: result.resultId,
    id: result.fileId,
    status: toDetailStatus(result.status),
    number: result.crawlerData?.number ?? result.fileName.replace(/\.[^.]+$/u, ""),
    path: fileRef.relativePath,
    fileRef,
    nfoRef: result.nfo,
    assets: result.assets,
    nfoPath: result.nfo?.relativePath,
    outputPath: result.output ? getDirectoryPath(result.output.relativePath) : undefined,
    errorMessage: result.error,
    ...buildDetailViewMetadata({
      crawlerData: result.crawlerData,
      videoMeta: result.videoMeta,
      assets: toAssetSources(result.assets),
    }),
  };
};

export const toDetailViewItemFromScrapeResultDto = (result: ScrapeResultDto): DetailViewItem => {
  const fileRef: RootFileRef =
    result.outputRootId && result.outputRelativePath
      ? { rootId: result.outputRootId, relativePath: result.outputRelativePath }
      : { rootId: result.rootId, relativePath: result.relativePath };
  const nfoRef = result.nfoRelativePath
    ? { rootId: result.nfoRootId ?? fileRef.rootId, relativePath: result.nfoRelativePath }
    : undefined;
  return {
    resultId: result.id,
    id: `${result.rootId}:${result.relativePath}`,
    status: toDetailStatus(result.status),
    number: result.crawlerData?.number ?? result.fileName.replace(/\.[^.]+$/u, ""),
    path: fileRef.relativePath,
    fileRef,
    nfoRef,
    assets: result.assets,
    nfoPath: result.nfoRelativePath ?? undefined,
    outputPath: result.outputRelativePath ? getDirectoryPath(result.outputRelativePath) : undefined,
    errorMessage: result.error ?? undefined,
    ...buildDetailViewMetadata({
      crawlerData: result.crawlerData ?? undefined,
      assets: toAssetSources(result.assets),
    }),
  };
};

export const toDetailViewItemFromMaintenanceEntry = (
  entry: LocalScanEntry,
  result?: MaintenanceItemResult | MaintenancePreviewItem,
): DetailViewItem => {
  const resultData =
    result && "proposedCrawlerData" in result
      ? result.proposedCrawlerData
      : result && "crawlerData" in result
        ? result.crawlerData
        : undefined;
  const crawlerData = entry.crawlerData ?? resultData;
  const hasEntryError = Boolean(entry.scanError);
  const hasResultError = result?.status === "failed" || result?.status === "blocked";
  const minimalErrorView = hasEntryError && !entry.crawlerData && !resultData;

  if (minimalErrorView) {
    return {
      id: entry.fileId,
      status: "failed",
      number: entry.fileInfo.number,
      minimalErrorView: true,
      path: entry.fileInfo.filePath,
      fileRef: entry.rootRef,
      nfoPath: entry.nfoPath,
      resolution: entry.fileInfo.resolution,
      title: entry.fileInfo.fileName,
      errorMessage: hasResultError ? result?.error : entry.scanError,
    };
  }

  return {
    id: entry.fileId,
    status: toDetailStatus(result?.status),
    number: entry.fileInfo.number,
    minimalErrorView: false,
    path: entry.fileInfo.filePath,
    fileRef: entry.rootRef,
    nfoPath: entry.nfoPath,
    outputPath: entry.currentDir,
    errorMessage: hasResultError ? result?.error : undefined,
    ...buildDetailViewMetadata({
      crawlerData,
      resolution: entry.fileInfo.resolution,
      assets: entry.assets,
    }),
    title: crawlerData?.title_zh ?? crawlerData?.title ?? entry.fileInfo.fileName,
  };
};
