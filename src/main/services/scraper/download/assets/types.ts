import type { Configuration } from "@main/services/config";
import type { CrawlerData, DownloadedAssets, MaintenanceAssetDecisions } from "@shared/types";
import type { ImageAlternatives } from "../../aggregation";
import type { ImageDownloadService } from "../ImageDownloadService";
import type { SceneImageDownloader } from "../SceneImageDownloader";

export type RefreshableAssetKey = keyof Pick<DownloadedAssets, "thumb" | "poster" | "fanart">;
export type PrimaryImageKey = keyof Pick<DownloadedAssets, "thumb" | "poster">;
export type AssetDecision = MaintenanceAssetDecisions[keyof MaintenanceAssetDecisions];

/** Optional callbacks for download progress reporting. */
export interface DownloadCallbacks {
  /** Called after each scene image completes (success or fail). */
  onSceneProgress?: (downloaded: number, total: number) => void;
  /** Reports the exact remote URLs that produced the finalized local scene image set for this scrape. */
  onResolvedSceneImageUrls?: (urls: string[] | undefined) => void;
  /** Force a primary image to refresh even when its keep flag is enabled. */
  forceReplace?: Partial<Record<RefreshableAssetKey, boolean>>;
  /** Preserve or replace selected maintenance-managed assets regardless of preset keep flags. */
  assetDecisions?: MaintenanceAssetDecisions;
  /** Cancels in-flight work when the current scrape is stopped. */
  signal?: AbortSignal;
}

export interface DownloadExecutionPlan {
  outputDir: string;
  data: CrawlerData;
  config: Configuration;
  imageAlternatives: Partial<ImageAlternatives>;
  callbacks?: DownloadCallbacks;
  forceReplace: Partial<Record<RefreshableAssetKey, boolean>>;
  assetDecisions: MaintenanceAssetDecisions;
  signal?: AbortSignal;
}

export interface DownloadExecutionContext {
  plan: DownloadExecutionPlan;
  assets: DownloadedAssets;
  imageDownloader: ImageDownloadService;
  sceneImageDownloader: SceneImageDownloader;
  logger: {
    warn(message: string): void;
  };
}

export interface AssetDownloader {
  shouldDownload(plan: DownloadExecutionPlan): boolean;
  download(context: DownloadExecutionContext): Promise<void>;
}
