import { dirname, resolve } from "node:path";
import { createMediaRoot, deterministicMediaRootId, type MediaRoot } from "@mdcz/media-store";
import type { MediaLibraryRecord } from "@mdcz/persistence";
import type { Configuration } from "@mdcz/shared/config";
import type {
  AmazonPosterApplyItem,
  AmazonPosterApplyResultItem,
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
} from "@mdcz/shared/toolTypes";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { resolveFileNaming } from "../library/mediaLibraryService";
import { installPoster, type PosterInstallContext, posterTargetPath } from "../scrape/posterOutput";
import { validateImage } from "../scrape/utils/image";
import { type RuntimeLogger, runtimeLoggerService, toErrorMessage } from "../shared";
import {
  AmazonJpImageService,
  type AmazonJpNetworkClient,
  type AmazonJpPosterEnhanceResult,
} from "./AmazonJpImageService";

type AmazonPosterLocalScanService = {
  scan(dirPath: string, sceneImagesFolder: string): Promise<LocalScanEntry[]>;
  scanVideo(root: MediaRoot, videoPath: string, sceneImagesFolder: string): Promise<LocalScanEntry>;
};

export interface AmazonPosterDependencies {
  enhanceAmazonPoster?: (title: string) => Promise<AmazonJpPosterEnhanceResult>;
  logger?: Pick<RuntimeLogger, "warn">;
}

export interface AmazonPosterApplyDependencies extends Omit<PosterInstallContext, "config" | "logger"> {
  localScanService: AmazonPosterLocalScanService;
  /** Name a poster for a movie that has none the way its library names files. */
  libraries: readonly MediaLibraryRecord[];
  logger?: Pick<RuntimeLogger, "warn">;
}

export const scanAmazonPosters = async (
  rootDirectory: string,
  config: Pick<Configuration, "paths">,
  localScanService: AmazonPosterLocalScanService,
): Promise<AmazonPosterScanItem[]> => {
  const entries = await localScanService.scan(resolve(rootDirectory.trim()), config.paths.sceneImagesFolder);
  const nfoPaths = new Set<string>();
  const items: AmazonPosterScanItem[] = [];
  for (const { nfoPath, crawlerData, fileInfo, assets, nfoLocalState } of entries) {
    if (!nfoPath || !crawlerData || nfoPaths.has(resolve(nfoPath))) continue;
    nfoPaths.add(resolve(nfoPath));
    // Small, low-resolution posters are the ones worth replacing, so none is too small to measure.
    const poster = assets.poster ? await validateImage(assets.poster, 0) : undefined;
    items.push({
      filePath: fileInfo.filePath,
      nfoPath,
      title: crawlerData.title,
      number: crawlerData.number || fileInfo.number,
      currentPosterPath: assets.poster ?? null,
      currentPosterWidth: poster?.valid ? poster.width : 0,
      currentPosterHeight: poster?.valid ? poster.height : 0,
      posterCut: nfoLocalState?.posterRecord?.cut,
    });
  }
  return items.sort((left, right) => left.nfoPath.localeCompare(right.nfoPath, "zh-CN"));
};

export const lookupAmazonPoster = async (
  networkClient: AmazonJpNetworkClient,
  nfoPath: string,
  title: string,
  dependencies: AmazonPosterDependencies = {},
): Promise<AmazonPosterLookupResult> => {
  const normalizedNfoPath = resolve(nfoPath.trim());
  const startedAt = Date.now();
  try {
    const result = dependencies.enhanceAmazonPoster
      ? await dependencies.enhanceAmazonPoster(title)
      : await new AmazonJpImageService(networkClient, dependencies.logger).enhance(title);
    return {
      nfoPath: normalizedNfoPath,
      amazonPosterUrl: result.poster_url ?? null,
      reason: result.reason,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      nfoPath: normalizedNfoPath,
      amazonPosterUrl: null,
      reason: "query_failed",
      error: toErrorMessage(error),
      elapsedMs: Date.now() - startedAt,
    };
  }
};

/** Each poster is cut and badged like one maintenance rebuilds, and its NFO records how, so later rebuilds repeat it. */
export const applyAmazonPosters = async (
  items: readonly AmazonPosterApplyItem[],
  config: Configuration,
  dependencies: AmazonPosterApplyDependencies,
): Promise<AmazonPosterApplyResultItem[]> => {
  const logger = dependencies.logger ?? runtimeLoggerService.getLogger("AmazonPoster");
  const results: AmazonPosterApplyResultItem[] = [];
  for (const item of items) {
    const videoDirectory = dirname(item.filePath);
    try {
      const entry = await dependencies.localScanService.scanVideo(
        createMediaRoot({
          id: deterministicMediaRootId(videoDirectory),
          displayName: videoDirectory,
          hostPath: videoDirectory,
        }),
        item.filePath,
        config.paths.sceneImagesFolder,
      );
      if (!entry.nfoPath || !entry.crawlerData) throw new Error("Missing writable NFO or metadata");
      const posterPath =
        entry.assets.poster ??
        posterTargetPath(
          item.filePath,
          (
            await resolveFileNaming({
              libraries: dependencies.libraries,
              videoPath: item.filePath,
              metadataDir: dirname(entry.nfoPath),
              configuration: config,
            })
          ).assetNaming,
          entry.assets,
        );
      await installPoster(
        entry,
        posterPath,
        { source: item.amazonPosterUrl, crop: item.crop },
        { ...dependencies, config, logger },
      );
      results.push({ filePath: item.filePath, success: true });
    } catch (error) {
      results.push({ filePath: item.filePath, success: false, error: toErrorMessage(error) });
    }
  }
  return results;
};
