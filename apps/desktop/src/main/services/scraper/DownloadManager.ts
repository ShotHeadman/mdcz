import type { Configuration } from "@main/services/config";
import {
  createImageHostCooldownStore,
  type PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import { buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { CrawlerData, DownloadedAssets } from "@mdcz/shared/types";
import { throwIfAborted } from "./abort";
import type { ImageAlternatives } from "./aggregation";
import { FanartAssetDownloader } from "./download/assets/FanartAssetDownloader";
import { PrimaryImageAssetDownloader } from "./download/assets/PrimaryImageAssetDownloader";
import { SceneImageAssetDownloader } from "./download/assets/SceneImageAssetDownloader";
import { TrailerAssetDownloader } from "./download/assets/TrailerAssetDownloader";
import type {
  AssetDownloader,
  DownloadCallbacks,
  DownloadExecutionContext,
  DownloadExecutionPlan,
} from "./download/assets/types";
import { ImageDownloadService } from "./download/ImageDownloadService";
import { ImageHostCooldownTracker } from "./download/ImageHostCooldownTracker";
import { SceneImageDownloader } from "./download/SceneImageDownloader";

export type { DownloadCallbacks } from "./download/assets/types";

interface DownloadManagerOptions {
  imageHostCooldownStore?: PersistentCooldownStore;
}

interface DownloadExecutionOptions {
  movieBaseName?: string;
}

export class DownloadManager {
  private readonly logger = loggerService.getLogger("DownloadManager");

  private readonly imageDownloader: ImageDownloadService;

  private readonly sceneImageDownloader: SceneImageDownloader;

  private readonly downloaders: AssetDownloader[];

  constructor(networkClient: NetworkClient, options: DownloadManagerOptions = {}) {
    const imageHostCooldownStore = options.imageHostCooldownStore ?? createImageHostCooldownStore();
    const hostCooldownTracker = new ImageHostCooldownTracker(imageHostCooldownStore, this.logger);

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
    imageAlternatives: Partial<ImageAlternatives> = {},
    callbacks?: DownloadCallbacks,
    options: DownloadExecutionOptions = {},
  ): Promise<DownloadedAssets> {
    const assets: DownloadedAssets = {
      sceneImages: [],
      downloaded: [],
    };

    const plan = this.createExecutionPlan(outputDir, data, config, imageAlternatives, callbacks, options);
    const context: DownloadExecutionContext = {
      plan,
      assets,
      imageDownloader: this.imageDownloader,
      sceneImageDownloader: this.sceneImageDownloader,
      logger: this.logger,
    };

    throwIfAborted(plan.signal);

    for (const downloader of this.downloaders) {
      if (!downloader.shouldDownload(plan)) {
        continue;
      }

      throwIfAborted(plan.signal);
      await downloader.download(context);
    }

    return assets;
  }

  private createExecutionPlan(
    outputDir: string,
    data: CrawlerData,
    config: Configuration,
    imageAlternatives: Partial<ImageAlternatives>,
    callbacks?: DownloadCallbacks,
    options: DownloadExecutionOptions = {},
  ): DownloadExecutionPlan {
    const movieBaseName = options.movieBaseName?.trim() || data.number.trim();

    return {
      outputDir,
      movieBaseName,
      assetFileNames: buildMovieAssetFileNames(movieBaseName, config.naming.assetNamingMode),
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
