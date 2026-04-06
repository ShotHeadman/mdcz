import type { Configuration } from "@main/services/config";
import { PersistentCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { CrawlerData, DownloadedAssets } from "@shared/types";
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

export class DownloadManager {
  private readonly logger = loggerService.getLogger("DownloadManager");

  private readonly imageDownloader: ImageDownloadService;

  private readonly sceneImageDownloader: SceneImageDownloader;

  private readonly downloaders: AssetDownloader[];

  constructor(networkClient: NetworkClient, options: DownloadManagerOptions = {}) {
    const imageHostCooldownStore =
      options.imageHostCooldownStore ??
      new PersistentCooldownStore({
        fileName: "image-host-cooldowns.json",
        loggerName: "ImageHostCooldownStore",
      });
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
  ): Promise<DownloadedAssets> {
    const assets: DownloadedAssets = {
      sceneImages: [],
      downloaded: [],
    };

    const plan = this.createExecutionPlan(outputDir, data, config, imageAlternatives, callbacks);
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
  ): DownloadExecutionPlan {
    return {
      outputDir,
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
