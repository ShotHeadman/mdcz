import { dirname, join } from "node:path";
import { buildMovieAssetFileNames } from "@mdcz/shared/assetNaming";
import type { Configuration } from "@mdcz/shared/config";
import type { MovieNaming } from "@mdcz/shared/mediaLibrary";
import { resolveThumbToPosterCropRegion } from "@mdcz/shared/posterCrop";
import type { CrawlerData, DiscoveredAssets, DownloadedAssets, PosterCut } from "@mdcz/shared/types";
import sharp from "sharp";
import { type RuntimeDownloadNetworkClient, runWithNetworkChannel } from "../../network";
import { type RuntimeLogger, runtimeLoggerService } from "../../shared";
import type { ImageAlternatives } from "../aggregation";
import { DirectoryInventory } from "../DirectoryInventory";
import { cutPoster } from "../posterCut";
import { throwIfAborted } from "../utils/abort";
import type { ImageDimensions } from "../utils/image";
import { FanartAssetDownloader } from "./assets/FanartAssetDownloader";
import { buildImageCandidates } from "./assets/helpers";
import { PosterImageDerivationService } from "./assets/PosterImageDerivationService";
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

type PlainPosterSources = Pick<CrawlerData, "poster_source_url" | "thumb_source_url">;

// A poster cropped from the cover names the cover as its source; any other source is the site's own poster.
const scrapedSitePoster = (data: PlainPosterSources): string | undefined =>
  data.poster_source_url && data.poster_source_url !== data.thumb_source_url ? data.poster_source_url : undefined;

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

  /**
   * The poster without badges, made the way it was made before. A cut poster is cut again from its source; a poster
   * scraping made follows the scrape's rule, cropped again from the cover or fetched again from the site.
   */
  async downloadPlainPoster(input: {
    data: PlainPosterSources;
    cut?: PosterCut;
    targetPath: string;
    thumbPath?: string;
    signal?: AbortSignal;
  }): Promise<string | undefined> {
    const { data, cut, targetPath, signal } = input;
    const resolveCover = async () =>
      input.thumbPath ??
      (data.thumb_source_url
        ? await this.imageDownloader.downloadBestImage(
            [data.thumb_source_url],
            join(dirname(targetPath), ".mdcz-cover.jpg"),
            signal,
          )
        : undefined);
    return await runWithNetworkChannel("media", async () => {
      if (cut) {
        const sourcePath =
          cut.source === "cover"
            ? await resolveCover()
            : await this.imageDownloader.downloadBestImage(
                [cut.source],
                join(dirname(targetPath), ".mdcz-poster-source.jpg"),
                signal,
              );
        if (!sourcePath) return undefined;
        if (await cutPoster(sourcePath, cut.crop, targetPath)) return targetPath;
        this.logger.warn(`${cut.source} changed shape since the poster was cut from it`);
        return undefined;
      }
      const sitePoster = scrapedSitePoster(data);
      const posterPath = sitePoster
        ? await this.imageDownloader.downloadBestImage([sitePoster], targetPath, signal)
        : undefined;
      if (sitePoster && !posterPath) return undefined;
      const derived = await new PosterImageDerivationService(this.logger).deriveFromThumbIfNeeded({
        posterPath,
        targetPath,
        resolveThumbPath: resolveCover,
      });
      if (derived.status === "derived") return derived.path;
      return derived.reason === "large_poster" ? posterPath : undefined;
    });
  }

  /** Reads an image's size through the ranged probe, without downloading it. */
  async probeImageSize(url: string, signal?: AbortSignal): Promise<ImageDimensions | undefined> {
    return await runWithNetworkChannel("media", async () => await this.imageDownloader.probeImageSize(url, signal));
  }

  /** The size `downloadPlainPoster` gives a poster scraping made, read from the local cover or probed from the site. */
  async plainPosterSize(input: {
    data: PlainPosterSources;
    thumbPath?: string;
    signal?: AbortSignal;
  }): Promise<ImageDimensions | undefined> {
    const sitePoster = scrapedSitePoster(input.data);
    if (sitePoster) return await this.probeImageSize(sitePoster, input.signal);
    if (!input.thumbPath) return undefined;
    const { width = 0, height = 0 } = await sharp(input.thumbPath).metadata();
    const region = resolveThumbToPosterCropRegion(width, height);
    return region ? { width: region.width, height: region.height } : { width, height };
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
