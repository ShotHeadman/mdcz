import type {
  CrawlerData,
  DiscoveredAssets,
  DownloadedAssets,
  LocalScanEntry,
  MaintenanceItemResult,
  MaintenancePreviewItem,
  ScrapeResult,
  VideoMeta,
} from "@mdcz/shared/types";
import type { DetailViewItem } from "./types";

type DetailLocalAssets = Pick<DiscoveredAssets, "poster" | "thumb" | "fanart" | "sceneImages">;
type DetailDownloadedAssets = Pick<DownloadedAssets, "poster" | "thumb" | "fanart" | "sceneImages">;

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

const resolveArtworkUrls = (
  crawlerData: CrawlerData | undefined,
  assets: DetailLocalAssets | DetailDownloadedAssets | undefined,
) => ({
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
  assets?: DetailLocalAssets | DetailDownloadedAssets;
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
  };
};

export const getScrapeResultTitle = (result: ScrapeResult): string | undefined =>
  result.crawlerData?.title_zh ?? result.crawlerData?.title;

export const getMaintenanceDetailTitle = (entry: LocalScanEntry) =>
  entry.crawlerData?.title_zh ?? entry.crawlerData?.title ?? entry.fileInfo.fileName;

export const toDetailViewItemFromScrapeResult = (result: ScrapeResult): DetailViewItem => ({
  id: result.fileId,
  status: toDetailStatus(result.status),
  number: result.fileInfo.number,
  path: result.fileInfo.filePath,
  nfoPath: result.nfoPath,
  outputPath: result.outputPath,
  errorMessage: result.error,
  ...buildDetailViewMetadata({
    crawlerData: result.crawlerData,
    videoMeta: result.videoMeta,
    assets: result.assets,
  }),
});

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
