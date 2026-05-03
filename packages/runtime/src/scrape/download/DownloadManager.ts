import { buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, DownloadedAssets } from "@mdcz/shared/types";
import type { RuntimeDownloadNetworkClient } from "../../network";
import { type RuntimeLogger, runtimeLoggerService } from "../../shared";
import type { ImageAlternatives } from "../aggregation";
import { throwIfAborted } from "../utils/abort";
import { FanartAssetDownloader } from "./assets/FanartAssetDownloader";
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
