import { basename, dirname, join, resolve } from "node:path";
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
import { type MovieLibrary, resolveRegisteredNfoPaths } from "../library/registeredMedia";
import { createStagingDirectory, removeStagingDirectory } from "../publication/publicationJournal";
import type { PublicationOutputPort } from "../publication/types";
import type { DownloadManager } from "../scrape/download/DownloadManager";
import type { NfoGenerator } from "../scrape/nfo";
import { applyPosterTagBadgesIfNeeded } from "../scrape/output/applyPosterTagBadges";
import { installPoster, posterTargetPath } from "../scrape/posterOutput";
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

export interface AmazonPosterApplyDependencies {
  downloadManager: Pick<DownloadManager, "downloadPlainPoster">;
  localScanService: AmazonPosterLocalScanService;
  nfoGenerator: Pick<NfoGenerator, "mergePosterRecordXml">;
  dataDir: string;
  /** Name a poster for a movie that has none the way its library names files. */
  libraries: readonly MediaLibraryRecord[];
  publication: {
    roots: readonly { id: string; hostPath: string }[];
    /** Absent outside the library, where no NFO copy or asset row is registered. */
    library?: MovieLibrary & PublicationOutputPort;
  };
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
  const { library, roots } = dependencies.publication;
  const logger = dependencies.logger ?? runtimeLoggerService.getLogger("AmazonPoster");
  const results: AmazonPosterApplyResultItem[] = [];
  for (const item of items) {
    const videoDirectory = dirname(item.filePath);
    let stagingDir: string | undefined;
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
      const { nfoPath, crawlerData } = entry;
      if (!nfoPath || !crawlerData) throw new Error("Missing writable NFO or metadata");
      const posterPath = entry.assets.poster
        ? entry.assets.poster
        : posterTargetPath(
            item.filePath,
            (
              await resolveFileNaming({
                libraries: dependencies.libraries,
                videoPath: item.filePath,
                metadataDir: dirname(nfoPath),
                configuration: config,
              })
            ).assetNaming,
            entry.assets,
          );
      stagingDir = await createStagingDirectory(dirname(posterPath));
      const cut = { source: item.amazonPosterUrl, crop: item.crop };
      const stagedPoster = await dependencies.downloadManager.downloadPlainPoster({
        data: crawlerData,
        cut,
        targetPath: join(stagingDir, basename(posterPath)),
      });
      if (!stagedPoster) throw new Error(`Could not cut a poster from ${item.amazonPosterUrl}`);
      const { posterRecord } = await applyPosterTagBadgesIfNeeded({
        assets: { poster: stagedPoster, sceneImages: [], downloaded: [stagedPoster] },
        config,
        crawlerData,
        dataDir: dependencies.dataDir,
        fileInfo: entry.fileInfo,
        localState: entry.nfoLocalState,
        logger,
      });
      if (!posterRecord) throw new Error("Badge drawing returned no poster record");
      const registered = library
        ? await resolveRegisteredNfoPaths(nfoPath, library, async (id) => {
            const root = roots.find((root) => root.id === id);
            if (!root) throw new Error(`Publication root not found: ${id}`);
            return root;
          })
        : undefined;
      await installPoster({
        posterPath,
        stagedPoster,
        record: {
          value: { ...posterRecord, cut },
          nfoPaths: registered?.paths ?? entry.nfoPaths,
          nfoGenerator: dependencies.nfoGenerator,
        },
        protectedMediaFiles: registered?.mediaPaths ?? [item.filePath],
        movie: library && registered ? { library, movieId: registered.movieId, roots } : undefined,
        logger,
      });
      results.push({ filePath: item.filePath, success: true });
    } catch (error) {
      results.push({ filePath: item.filePath, success: false, error: toErrorMessage(error) });
    } finally {
      if (stagingDir) await removeStagingDirectory(stagingDir);
    }
  }
  return results;
};
