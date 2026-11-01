import { join } from "node:path";
import { buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import type { MovieNaming } from "@mdcz/shared/mediaLibrary";
import type { CrawlerData, DiscoveredAssets, DownloadedAssets } from "@mdcz/shared/types";
import { type RuntimeDownloadNetworkClient, runWithNetworkChannel } from "../../network";
import { type RuntimeLogger, runtimeLoggerService } from "../../shared";
import type { ImageAlternatives } from "../aggregation";
import { DirectoryInventory } from "../DirectoryInventory";
import { throwIfAborted } from "../utils/abort";
import { FanartAssetDownloader } from "./assets/FanartAssetDownloader";
import { buildImageCandidates } from "./assets/helpers";
import { PrimaryImageAssetDownloader } from "./assets/PrimaryImageAssetDownloader";
import { SceneImageAssetDownloader } from "./assets/SceneImageAssetDownloader";
import { TrailerAssetDownloader } from "./assets/TrailerAssetDownloader";
import type {
  AssetDownloader,
  DownloadCallbacks,
  DownloadExecutionContext,
  DownloadExecutionPlan,
} from "./assets/types";
import { ImageDownloadService } from "./ImageDownloadService";
import { type ImageHostCooldownStore, ImageHostCooldownTracker } from "./ImageHostCooldownTracker";
import { SceneImageDownloader } from "./SceneImageDownloader";

export type { DownloadCallbacks } from "./assets/types";

export interface DownloadManagerOptions {
  imageHostCooldownStore: ImageHostCooldownStore;
  logger?: Pick<RuntimeLogger, "info" | "warn">;
}

interface DownloadExecutionOptions {
  movieBaseName?: string;
  existingAssetDir?: string;
  existingAssets?: DiscoveredAssets;
  inventory?: DirectoryInventory;
}

export class DownloadManager {
  private readonly logger: Pick<RuntimeLogger, "info" | "warn">;

  private readonly imageDownloader: ImageDownloadService;

  private readonly sceneImageDownloader: SceneImageDownloader;

  private readonly downloaders: AssetDownloader[];

  constructor(networkClient: RuntimeDownloadNetworkClient, options: DownloadManagerOptions) {
    this.logger = options.logger ?? runtimeLoggerService.getLogger("DownloadManager");
    const hostCooldownTracker = new ImageHostCooldownTracker(options.imageHostCooldownStore, this.logger);

    this.imageDownloader = new ImageDownloadService(networkClient, hostCooldownTracker, this.logger);
    this.sceneImageDownloader = new SceneImageDownloader(this.imageDownloader, hostCooldownTracker, this.logger);
    this.downloaders = [
      new PrimaryImageAssetDownloader(),
      new SceneImageAssetDownloader(),
      new FanartAssetDownloader(),
      new TrailerAssetDownloader(),
    ];
  }

  async downloadAll(
    outputDir: string,
    data: CrawlerData,
    config: Configuration,
    naming: MovieNaming,
    imageAlternatives: Partial<ImageAlternatives> = {},
    callbacks?: DownloadCallbacks,
    options: DownloadExecutionOptions = {},
  ): Promise<DownloadedAssets> {
    const assets: DownloadedAssets = {
      sceneImages: [],
      downloaded: [],
    };

    const plan = this.createExecutionPlan(outputDir, data, config, naming, imageAlternatives, callbacks, options);
    let cover: Promise<string | undefined> | undefined;
    const context: DownloadExecutionContext = {
      plan,
      assets,
      imageDownloader: this.imageDownloader,
      sceneImageDownloader: this.sceneImageDownloader,
      // outputDir is the publication staging folder, so a cover fetched there only as a source is never published.
      resolveCover: async () => {
        if (assets.thumb || config.download.downloadThumb) return assets.thumb;
        cover ??= this.imageDownloader.downloadBestImage(
          buildImageCandidates(data.thumb_url, plan.imageAlternatives.thumb_url),
          join(outputDir, ".mdcz-cover.jpg"),
          plan.signal,
        );
        return await cover;
      },
      logger: this.logger,
    };

    throwIfAborted(plan.signal);

    await runWithNetworkChannel("media", async () => {
      for (const downloader of this.downloaders) {
        if (!downloader.shouldDownload(plan)) continue;
        throwIfAborted(plan.signal);
        await downloader.download(context);
      }
    });

    const downloadedPaths = new Set(assets.downloaded);
    const existingKinds = [
      assets.thumb && !downloadedPaths.has(assets.thumb) ? "thumb" : undefined,
      assets.poster && !downloadedPaths.has(assets.poster) ? "poster" : undefined,
      assets.fanart && !downloadedPaths.has(assets.fanart) ? "fanart" : undefined,
      assets.trailer && !downloadedPaths.has(assets.trailer) ? "trailer" : undefined,
      assets.sceneImages.length > 0 && assets.sceneImages.every((asset) => !downloadedPaths.has(asset))
        ? "scene images"
        : undefined,
    ].filter((kind): kind is string => Boolean(kind));
    if (existingKinds.length > 0) {
      this.logger.info(`[${data.number}] Using existing local assets: ${existingKinds.join(", ")}`);
    }

    return assets;
  }

  private createExecutionPlan(
    outputDir: string,
    data: CrawlerData,
    config: Configuration,
    naming: MovieNaming,
    imageAlternatives: Partial<ImageAlternatives>,
    callbacks?: DownloadCallbacks,
    options: DownloadExecutionOptions = {},
  ): DownloadExecutionPlan {
    const movieBaseName = options.movieBaseName?.trim() || data.number.trim();

    return {
      outputDir,
      existingAssetDir: options.existingAssetDir ?? outputDir,
      existingAssets: options.existingAssets,
      inventory: options.inventory ?? new DirectoryInventory(),
      movieBaseName,
      assetFileNames: buildMovieAssetFileNames(movieBaseName, naming.assetNaming),
      sceneImages: naming.sceneImages,
      data,
      config,
      imageAlternatives,
      callbacks,
      forceReplace: callbacks?.forceReplace ?? {},
      assetDecisions: callbacks?.assetDecisions ?? {},
      signal: callbacks?.signal,
    };
  }
}
