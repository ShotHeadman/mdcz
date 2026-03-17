import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Configuration } from "@main/services/config";
import {
  type ActiveCooldown,
  type CooldownFailurePolicy,
  PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient, ProbeResult } from "@main/services/network";
import { toErrorMessage } from "@main/utils/common";
import { pathExists } from "@main/utils/file";
import { validateImage } from "@main/utils/image";
import type { Website } from "@shared/enums";
import type { CrawlerData, DownloadedAssets, MaintenanceAssetDecisions } from "@shared/types";
import { isAbortError, throwIfAborted } from "./abort";
import type { ImageAlternatives } from "./aggregation";

const normalizeUrl = (input?: string): string | null => {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return null;
};

const resolveExistingAsset = async (assetPath: string): Promise<string | undefined> => {
  return (await pathExists(assetPath)) ? assetPath : undefined;
};

const resolveSingleAsset = async ({
  targetPath,
  keepExisting,
  fallbackToExistingOnFailure = true,
  create,
}: {
  targetPath: string;
  keepExisting: boolean;
  fallbackToExistingOnFailure?: boolean;
  create: () => Promise<string | null>;
}): Promise<{ assetPath?: string; createdPath?: string }> => {
  const existingPath = await resolveExistingAsset(targetPath);
  if (keepExisting && existingPath) {
    return { assetPath: existingPath };
  }

  const createdPath = await create();
  if (createdPath) {
    return { assetPath: createdPath, createdPath };
  }

  return fallbackToExistingOnFailure ? { assetPath: existingPath } : {};
};

/** Optional callbacks for download progress reporting. */
export interface DownloadCallbacks {
  /** Called after each scene image completes (success or fail). */
  onSceneProgress?: (downloaded: number, total: number) => void;
  /** Reports the exact remote URLs that produced the finalized local scene image set for this scrape. */
  onResolvedSceneImageUrls?: (urls: string[] | undefined) => void;
  /** Force a primary image to refresh even when its keep flag is enabled. */
  forceReplace?: Partial<Record<PrimaryImageKey, boolean>>;
  /** Preserve or replace selected maintenance-managed assets regardless of preset keep flags. */
  assetDecisions?: MaintenanceAssetDecisions;
  /** Cancels in-flight work when the current scrape is stopped. */
  signal?: AbortSignal;
}

type PrimaryImageKey = keyof Pick<DownloadedAssets, "thumb" | "poster" | "fanart">;
type PrimaryImageTask = { key: PrimaryImageKey; candidates: string[]; path: string; keepExisting: boolean };
type ParallelResult<K extends string, TValue> = { key: K; path: string; success: boolean; value?: TValue };
type ProbedImageCandidate = ProbeResult & { index: number; url: string };
type ProbedImageCandidateWithDimensions = ProbedImageCandidate & { width: number; height: number };
type SceneImageCandidate = { index: number; url: string; host: string | null };
type SceneImageSet = { urls: string[]; source?: Website };
type ImageDownloadSkipReason = "host_cooldown" | "download_failed" | "invalid_image";
type SafeDownloadResult =
  | { status: "downloaded"; path: string }
  | { status: "skipped"; reason: "host_cooldown" | "download_failed" };
type DownloadValidatedImageResult =
  | { status: "downloaded"; path: string; width: number; height: number }
  | { status: "skipped"; reason: ImageDownloadSkipReason };
type DownloadedImageCandidate = {
  url: string;
  path: string;
  width: number;
  height: number;
  rank: number;
};
type DownloadedSceneImage = {
  path: string;
  url: string;
};
interface DownloadManagerOptions {
  imageHostCooldownStore?: PersistentCooldownStore;
}

const IMAGE_HOST_COOLDOWN_MS = 5 * 60 * 1000;
const SCENE_IMAGE_ATTEMPT_TIMEOUT_MS = 3_000;
const SCENE_IMAGE_MIN_BYTES = 4_096;
const IMAGE_PROBE_TERMINAL_MISS_STATUS_CODES = new Set([404, 410]);
const IMAGE_HOST_FAILURE_POLICY: CooldownFailurePolicy = {
  threshold: 2,
  windowMs: IMAGE_HOST_COOLDOWN_MS,
  cooldownMs: IMAGE_HOST_COOLDOWN_MS,
};
const IMAGE_HOST_COOLDOWN_STATUS_CODES = new Set([408, 429]);

const uniqueFilePaths = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    paths.push(value);
  }

  return paths;
};

const getNormalizedSceneImageUrls = (values: string[]): string[] => {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of values) {
    const normalized = normalizeUrl(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
};

const getSceneImageSets = (
  data: CrawlerData,
  imageAlternatives: Partial<ImageAlternatives>,
  maxSceneImages: number,
): SceneImageSet[] => {
  if (maxSceneImages <= 0) {
    return [];
  }

  const seenSets = new Set<string>();
  const sets: SceneImageSet[] = [];
  const candidates: SceneImageSet[] = [
    {
      urls: data.sample_images,
      source: imageAlternatives.sample_images_source,
    },
    ...(imageAlternatives.sample_images ?? []).map((urls, index) => ({
      urls,
      source: imageAlternatives.sample_image_sources?.[index],
    })),
  ];
  for (const candidate of candidates) {
    const values = candidate.urls;
    const urls = getNormalizedSceneImageUrls(Array.isArray(values) ? values : []).slice(0, maxSceneImages);
    if (urls.length === 0) {
      continue;
    }

    const signature = JSON.stringify(urls);
    if (seenSets.has(signature)) {
      continue;
    }

    seenSets.add(signature);
    sets.push({
      urls,
      source: candidate.source,
    });
  }

  return sets;
};

const getUrlHost = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

const formatSceneImageSetDetails = (sceneImageSet: SceneImageSet): string => {
  const hosts = Array.from(
    new Set(sceneImageSet.urls.map((url) => getUrlHost(url)).filter((host): host is string => Boolean(host))),
  );
  const source = sceneImageSet.source ?? "unknown";
  const firstHost = hosts[0] ?? "unknown";
  const hostDetail = hosts.length <= 1 ? firstHost : `${firstHost}; ${hosts.length} hosts`;
  return `source=${source}, firstHost=${hostDetail}`;
};

const parseHttpStatus = (message?: string): number | null => {
  const match = message?.match(/\bHTTP (\d{3})\b/u);
  if (!match) {
    return null;
  }

  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : null;
};

const shouldRecordImageHostFailure = (status?: number, reason?: string): boolean => {
  const resolvedStatus = typeof status === "number" && status > 0 ? status : parseHttpStatus(reason);
  if (resolvedStatus === null) {
    return true;
  }

  return IMAGE_HOST_COOLDOWN_STATUS_CODES.has(resolvedStatus) || resolvedStatus >= 500;
};

const createFailedProbeCandidate = (url: string, index: number): ProbedImageCandidate => ({
  url,
  index,
  ok: false,
  contentLength: null,
  status: 0,
  resolvedUrl: url,
});

const isExtrafanartFolder = (folderName: string): boolean => {
  return (
    folderName
      .trim()
      .replace(/[\\/]+$/u, "")
      .toLowerCase() === "extrafanart"
  );
};

const buildSceneImageFileName = (sceneFolder: string, index: number): string => {
  if (isExtrafanartFolder(sceneFolder)) {
    return `fanart${index + 1}.jpg`;
  }
  return `scene-${String(index + 1).padStart(3, "0")}.jpg`;
};

const buildSceneImageTempFileName = (setIndex: number, index: number): string =>
  `.scene-set-${String(setIndex + 1).padStart(2, "0")}-candidate-${String(index + 1).padStart(3, "0")}.jpg`;

const buildFileSignature = async (filePath: string): Promise<string | undefined> => {
  try {
    const bytes = await readFile(filePath);
    return createHash("sha1").update(bytes).digest("hex");
  } catch {
    return undefined;
  }
};

const formatCooldownDetails = (cooldownUntil: number, remainingMs: number): string =>
  `${remainingMs}ms remaining until ${new Date(cooldownUntil).toISOString()}`;

const SCENE_IMAGE_FILE_PATTERN = /^(?:scene-\d+|fanart\d+)\.(?:jpe?g|png|webp)$/iu;

export class DownloadManager {
  private readonly logger = loggerService.getLogger("DownloadManager");

  private readonly imageHostCooldownStore: PersistentCooldownStore;
  private readonly loggedCooldownUntilByImageHost = new Map<string, number>();

  constructor(
    private readonly networkClient: NetworkClient,
    options: DownloadManagerOptions = {},
  ) {
    this.imageHostCooldownStore =
      options.imageHostCooldownStore ??
      new PersistentCooldownStore({
        fileName: "image-host-cooldowns.json",
        loggerName: "ImageHostCooldownStore",
      });
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

    throwIfAborted(callbacks?.signal);

    const forceReplace = callbacks?.forceReplace ?? {};
    const assetDecisions = callbacks?.assetDecisions ?? {};
    const primaryTasks = this.buildPrimaryImageTasks(outputDir, data, config, imageAlternatives);
    const pendingPrimaryTasks: PrimaryImageTask[] = [];

    for (const task of primaryTasks) {
      const existingAsset = await resolveExistingAsset(task.path);
      if (task.keepExisting && existingAsset && !forceReplace[task.key]) {
        assets[task.key] = existingAsset;
        continue;
      }

      if (task.candidates.length > 0) {
        pendingPrimaryTasks.push(task);
      }
    }

    const primaryResults = await this.runParallel(pendingPrimaryTasks, 3, async (task) => {
      return await this.downloadBestImage(task.candidates, task.path, callbacks?.signal);
    });

    for (const result of primaryResults) {
      if (result.success) {
        const key = result.key as PrimaryImageKey;
        assets[key] = result.path;
        assets.downloaded.push(result.path);
      }
    }

    for (const task of primaryTasks) {
      if (!assets[task.key]) {
        const existingAsset = await resolveExistingAsset(task.path);
        if (existingAsset) {
          assets[task.key] = existingAsset;
        }
      }
    }

    if (config.download.downloadSceneImages) {
      throwIfAborted(callbacks?.signal);
      const sceneDir = join(outputDir, config.paths.sceneImagesFolder);
      const existingSceneImages = await this.listExistingSceneImages(sceneDir);
      const sceneImageComparisonPaths = uniqueFilePaths([
        assets.thumb,
        await resolveExistingAsset(join(outputDir, "fanart.jpg")),
      ]);
      const forceReplaceSceneImages = assetDecisions.sceneImages === "replace";
      const keepSceneImages =
        assetDecisions.sceneImages === "preserve"
          ? true
          : assetDecisions.sceneImages === "replace"
            ? false
            : config.download.keepSceneImages;

      if (keepSceneImages && existingSceneImages.length > 0) {
        assets.sceneImages.push(...existingSceneImages);
      } else {
        throwIfAborted(callbacks?.signal);
        const targetSceneCount = Math.max(0, config.aggregation.behavior.maxSceneImages);
        const sceneImageSets = getSceneImageSets(data, imageAlternatives, targetSceneCount);

        if (sceneImageSets.length === 0) {
          if (forceReplaceSceneImages && existingSceneImages.length > 0) {
            await this.removeStaleSceneImages(existingSceneImages, [], sceneDir);
          } else {
            assets.sceneImages.push(...existingSceneImages);
          }
          if (existingSceneImages.length > 0 && !forceReplaceSceneImages) {
            callbacks?.onResolvedSceneImageUrls?.(undefined);
          } else {
            callbacks?.onResolvedSceneImageUrls?.([]);
          }
        } else {
          const successfulSceneImages = await this.downloadSceneImageSets(
            outputDir,
            config.paths.sceneImagesFolder,
            sceneImageSets,
            targetSceneCount,
            config.download.sceneImageConcurrency,
            sceneImageComparisonPaths,
            callbacks,
          );

          const finalizedSceneCount = Math.min(targetSceneCount, successfulSceneImages.length);
          for (let index = 0; index < finalizedSceneCount; index += 1) {
            const sceneImage = successfulSceneImages[index];
            if (!sceneImage) {
              continue;
            }

            const finalPath = join(
              outputDir,
              config.paths.sceneImagesFolder,
              buildSceneImageFileName(config.paths.sceneImagesFolder, index),
            );

            await mkdir(dirname(finalPath), { recursive: true });
            await unlink(finalPath).catch(() => undefined);
            if (sceneImage.path !== finalPath) {
              await rename(sceneImage.path, finalPath);
            }
            assets.sceneImages.push(finalPath);
            assets.downloaded.push(finalPath);
          }

          for (let index = finalizedSceneCount; index < successfulSceneImages.length; index += 1) {
            await unlink(successfulSceneImages[index]?.path ?? "").catch(() => undefined);
          }

          if (!forceReplaceSceneImages && finalizedSceneCount === 0) {
            assets.sceneImages.push(...existingSceneImages.slice(0, targetSceneCount));
          }

          if (finalizedSceneCount > 0) {
            callbacks?.onResolvedSceneImageUrls?.(
              successfulSceneImages.slice(0, finalizedSceneCount).map((item) => item.url),
            );
          } else if (!forceReplaceSceneImages && existingSceneImages.length > 0) {
            callbacks?.onResolvedSceneImageUrls?.(undefined);
          } else {
            callbacks?.onResolvedSceneImageUrls?.([]);
          }

          if (assets.sceneImages.length > 0 || forceReplaceSceneImages) {
            await this.removeStaleSceneImages(existingSceneImages, assets.sceneImages, sceneDir);
          }
        }
      }
    }

    if (config.download.downloadFanart) {
      throwIfAborted(callbacks?.signal);
      const fanartTargetPath = join(outputDir, "fanart.jpg");
      const thumbPath = assets.thumb;

      if (thumbPath) {
        const thumbWasRefreshed = assets.downloaded.includes(thumbPath) || forceReplace.fanart;
        const keepFanart = thumbWasRefreshed
          ? false
          : assetDecisions.fanart === "preserve"
            ? true
            : assetDecisions.fanart === "replace"
              ? false
              : config.download.keepFanart;

        const fanartResult = await resolveSingleAsset({
          targetPath: fanartTargetPath,
          keepExisting: keepFanart,
          create: () => this.copyDerivedImage(thumbPath, fanartTargetPath, "fanart"),
        });
        if (fanartResult.assetPath) {
          assets.fanart = fanartResult.assetPath;
          if (fanartResult.createdPath) {
            assets.downloaded.push(fanartResult.createdPath);
          }
        }
      } else {
        const existingFanart = await resolveExistingAsset(fanartTargetPath);
        if (existingFanart) {
          assets.fanart = existingFanart;
        }
      }
    }

    if (config.download.downloadTrailer) {
      throwIfAborted(callbacks?.signal);
      const trailerPath = join(outputDir, "trailer.mp4");
      const url = normalizeUrl(data.trailer_url);
      const keepTrailer =
        assetDecisions.trailer === "preserve"
          ? true
          : assetDecisions.trailer === "replace"
            ? false
            : config.download.keepTrailer;
      const trailerResult = await resolveSingleAsset({
        targetPath: trailerPath,
        keepExisting: keepTrailer,
        fallbackToExistingOnFailure: assetDecisions.trailer !== "replace",
        create: async () => {
          if (!url) {
            return null;
          }

          const downloadResult = await this.safeDownload(url, trailerPath, { signal: callbacks?.signal });
          return downloadResult.status === "downloaded" ? downloadResult.path : null;
        },
      });
      if (trailerResult.assetPath) {
        assets.trailer = trailerResult.assetPath;
        if (trailerResult.createdPath) {
          assets.downloaded.push(trailerResult.createdPath);
        }
      }
    }

    return assets;
  }

  private async downloadSceneImageSets(
    outputDir: string,
    sceneFolder: string,
    sceneImageSets: SceneImageSet[],
    targetSceneCount: number,
    maxConcurrent: number,
    dedupeAgainstPaths: string[],
    callbacks?: DownloadCallbacks,
  ): Promise<DownloadedSceneImage[]> {
    if (targetSceneCount <= 0 || sceneImageSets.length === 0) {
      return [];
    }

    let bestPaths: DownloadedSceneImage[] = [];

    for (const [setIndex, sceneImageSet] of sceneImageSets.entries()) {
      throwIfAborted(callbacks?.signal);
      const urls = sceneImageSet.urls;
      const setDetails = formatSceneImageSetDetails(sceneImageSet);
      const attemptedUrls = this.filterSceneImageUrlsByHostCooldown(urls.slice(0, targetSceneCount));
      if (attemptedUrls.length === 0) {
        this.logger.info(
          `Skipping scene image set ${setIndex + 1}/${sceneImageSets.length} (${setDetails}): all image hosts are cooling down`,
        );
        continue;
      }
      this.logger.info(
        `Trying scene image set ${setIndex + 1}/${sceneImageSets.length} (${setDetails}) with ${attemptedUrls.length} image(s)`,
      );

      const downloadedPaths = await this.downloadSceneImageSet(
        outputDir,
        sceneFolder,
        setIndex,
        attemptedUrls,
        maxConcurrent,
        dedupeAgainstPaths,
        callbacks,
      );
      if (downloadedPaths.length === attemptedUrls.length) {
        await this.cleanupTemporarySceneImages(bestPaths);
        return downloadedPaths;
      }

      if (downloadedPaths.length > bestPaths.length) {
        await this.cleanupTemporarySceneImages(bestPaths);
        bestPaths = downloadedPaths;
      } else {
        await this.cleanupTemporarySceneImages(downloadedPaths);
      }

      callbacks?.onSceneProgress?.(0, attemptedUrls.length);
      this.logger.info(
        `Scene image set ${setIndex + 1}/${sceneImageSets.length} (${setDetails}) incomplete (${downloadedPaths.length}/${attemptedUrls.length}); trying next set`,
      );
    }

    return bestPaths;
  }

  private async downloadSceneImageSet(
    outputDir: string,
    sceneFolder: string,
    setIndex: number,
    urls: string[],
    maxConcurrent: number,
    dedupeAgainstPaths: string[],
    callbacks?: DownloadCallbacks,
  ): Promise<DownloadedSceneImage[]> {
    if (urls.length === 0) {
      return [];
    }

    throwIfAborted(callbacks?.signal);

    const results: Array<DownloadedSceneImage | null> = new Array(urls.length).fill(null);
    const temporaryPaths = new Set<string>();
    const coolingHosts = new Set<string>();
    const signatureCache = new Map<string, Promise<string | undefined>>();
    const seenSignatures = new Set<string>(
      (
        await Promise.all(
          dedupeAgainstPaths.map(async (filePath) => await this.getFileSignature(filePath, signatureCache)),
        )
      ).filter((value): value is string => Boolean(value)),
    );
    let abandonSet = false;
    let nextIndex = 0;
    const hostCount = new Set(urls.map((url) => getUrlHost(url) ?? url)).size;
    const workerCount = Math.min(urls.length, Math.max(1, Math.min(maxConcurrent, hostCount)));
    const runWorker = async (): Promise<void> => {
      while (true) {
        throwIfAborted(callbacks?.signal);
        if (abandonSet) {
          return;
        }
        const candidate = this.getNextSceneImageCandidate(urls, () => nextIndex++, coolingHosts);
        if (!candidate) {
          return;
        }

        const tempPath = join(outputDir, sceneFolder, buildSceneImageTempFileName(setIndex, candidate.index));
        const downloadResult = await this.downloadValidatedImageCandidate(candidate.url, tempPath, {
          timeoutMs: SCENE_IMAGE_ATTEMPT_TIMEOUT_MS,
          minBytes: SCENE_IMAGE_MIN_BYTES,
          signal: callbacks?.signal,
        });
        if (downloadResult.status !== "downloaded") {
          if (candidate.host && downloadResult.reason !== "invalid_image") {
            coolingHosts.add(candidate.host);
            abandonSet = true;
          }
          continue;
        }

        const signature = await this.getFileSignature(downloadResult.path, signatureCache);
        if (signature && seenSignatures.has(signature)) {
          await unlink(downloadResult.path).catch(() => undefined);
          continue;
        }

        if (signature) {
          seenSignatures.add(signature);
        }
        temporaryPaths.add(downloadResult.path);
        results[candidate.index] = {
          path: downloadResult.path,
          url: candidate.url,
        };
        callbacks?.onSceneProgress?.(
          results.filter((item): item is DownloadedSceneImage => Boolean(item)).length,
          urls.length,
        );
      }
    };

    try {
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    } catch (error) {
      for (const filePath of temporaryPaths) {
        await unlink(filePath).catch(() => undefined);
      }
      throw error;
    }

    return results.filter((item): item is DownloadedSceneImage => Boolean(item));
  }

  private filterSceneImageUrlsByHostCooldown(urls: string[]): string[] {
    return urls.filter((url) => !this.shouldSkipUrlForImageHostCooldown(url));
  }

  private getNextSceneImageCandidate(
    urls: string[],
    nextIndex: () => number,
    coolingHosts: Set<string>,
  ): SceneImageCandidate | null {
    while (true) {
      const index = nextIndex();
      const url = urls[index];
      if (!url) {
        return null;
      }

      const host = getUrlHost(url);
      if (host && coolingHosts.has(host)) {
        continue;
      }

      if (this.shouldSkipUrlForImageHostCooldown(url)) {
        if (host) {
          coolingHosts.add(host);
        }
        continue;
      }

      return { index, url, host };
    }
  }

  private buildPrimaryImageTasks(
    outputDir: string,
    data: CrawlerData,
    config: Configuration,
    imageAlternatives: Partial<ImageAlternatives>,
  ): PrimaryImageTask[] {
    const tasks: PrimaryImageTask[] = [];

    this.addPrimaryImageTask(
      tasks,
      "thumb",
      config.download.downloadThumb,
      config.download.keepThumb,
      data.thumb_url,
      imageAlternatives.thumb_url,
      join(outputDir, "thumb.jpg"),
    );
    this.addPrimaryImageTask(
      tasks,
      "poster",
      config.download.downloadPoster,
      config.download.keepPoster,
      data.poster_url,
      imageAlternatives.poster_url,
      join(outputDir, "poster.jpg"),
    );

    return tasks;
  }

  private addPrimaryImageTask(
    tasks: PrimaryImageTask[],
    key: PrimaryImageKey,
    enabled: boolean,
    keepExisting: boolean,
    primaryUrl: string | undefined,
    alternatives: string[] | undefined,
    path: string,
  ): void {
    if (!enabled) {
      return;
    }

    const candidates = this.buildImageCandidates(primaryUrl, alternatives);
    tasks.push({ key, candidates, path, keepExisting });
  }

  private buildImageCandidates(primaryUrl?: string, alternatives?: string[]): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];

    for (const url of [primaryUrl, ...(alternatives ?? [])]) {
      const normalized = normalizeUrl(url);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      candidates.push(normalized);
    }

    return candidates;
  }

  private async runParallel<K extends string, TTask extends { key: K; path: string }, TValue>(
    tasks: TTask[],
    maxConcurrent: number,
    runner: (task: TTask) => Promise<TValue | undefined>,
    onItemComplete?: () => void,
  ): Promise<Array<ParallelResult<K, TValue>>> {
    const results: Array<ParallelResult<K, TValue>> = new Array(tasks.length);
    if (tasks.length === 0) {
      return results;
    }

    let nextIndex = 0;
    const workerCount = Math.min(tasks.length, Math.max(1, maxConcurrent));
    const runWorker = async (): Promise<void> => {
      while (true) {
        const taskIndex = nextIndex++;
        const task = tasks[taskIndex];
        if (!task) {
          return;
        }

        try {
          const value = await runner(task);
          results[taskIndex] = {
            key: task.key,
            path: task.path,
            success: value !== undefined,
            value,
          };
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          const message = toErrorMessage(error);
          this.logger.warn(`Parallel task failed for ${task.path}: ${message}`);
          results[taskIndex] = { key: task.key, path: task.path, success: false };
        } finally {
          onItemComplete?.();
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
  }

  private async downloadBestImage(
    candidates: string[],
    outputPath: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (candidates.length === 0) {
      return undefined;
    }

    const probedCandidates = await this.orderImageCandidatesByProbe(candidates, signal, true);
    const downloadableCandidates = probedCandidates.filter((candidate) =>
      this.shouldAttemptCandidateDownload(candidate),
    );
    if (downloadableCandidates.length === 0) {
      return undefined;
    }

    if (this.canSelectBestImageFromProbe(downloadableCandidates)) {
      for (const candidate of downloadableCandidates) {
        throwIfAborted(signal);
        const downloadedPath = await this.downloadAndValidateImage(candidate.url, outputPath, { signal });
        if (downloadedPath) {
          return candidate.url;
        }
      }

      return undefined;
    }

    return await this.downloadBestImageByComparison(downloadableCandidates, outputPath, signal);
  }

  private async downloadBestImageByComparison(
    candidates: ProbedImageCandidate[],
    outputPath: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    let bestCandidate: DownloadedImageCandidate | null = null;
    const tempPaths = new Set<string>();

    try {
      for (const [rank, candidate] of candidates.entries()) {
        throwIfAborted(signal);
        if (bestCandidate && this.canSkipCandidateDownload(candidate, bestCandidate)) {
          continue;
        }

        const url = candidate.url;
        const tempPath = `${outputPath}.candidate-${rank + 1}.part`;
        const downloaded = await this.downloadValidatedImageCandidate(url, tempPath, { signal });
        if (downloaded.status !== "downloaded") {
          continue;
        }

        tempPaths.add(downloaded.path);
        const downloadedCandidate: DownloadedImageCandidate = {
          url,
          path: downloaded.path,
          width: downloaded.width,
          height: downloaded.height,
          rank,
        };

        if (!bestCandidate || this.isHigherResolutionCandidate(downloadedCandidate, bestCandidate)) {
          if (bestCandidate) {
            await unlink(bestCandidate.path).catch(() => undefined);
            tempPaths.delete(bestCandidate.path);
          }
          bestCandidate = downloadedCandidate;
          continue;
        }

        await unlink(downloadedCandidate.path).catch(() => undefined);
        tempPaths.delete(downloadedCandidate.path);
      }

      if (!bestCandidate) {
        return undefined;
      }

      throwIfAborted(signal);
      await unlink(outputPath).catch(() => undefined);
      await rename(bestCandidate.path, outputPath);
      tempPaths.delete(bestCandidate.path);
      return bestCandidate.url;
    } finally {
      for (const tempPath of tempPaths) {
        await unlink(tempPath).catch(() => undefined);
      }
    }
  }

  private async downloadAndValidateImage(
    url: string,
    outputPath: string,
    options: { timeoutMs?: number; minBytes?: number; signal?: AbortSignal } = {},
  ): Promise<string | null> {
    const candidate = await this.downloadValidatedImageCandidate(url, outputPath, options);
    return candidate.status === "downloaded" ? candidate.path : null;
  }

  private async downloadValidatedImageCandidate(
    url: string,
    outputPath: string,
    options: { timeoutMs?: number; minBytes?: number; signal?: AbortSignal } = {},
  ): Promise<DownloadValidatedImageResult> {
    throwIfAborted(options.signal);
    const downloadResult = await this.safeDownload(url, outputPath, options);
    if (downloadResult.status !== "downloaded") {
      return downloadResult;
    }

    try {
      const validation = await validateImage(downloadResult.path, options.minBytes);
      if (validation.valid) {
        return {
          status: "downloaded",
          path: downloadResult.path,
          width: validation.width,
          height: validation.height,
        };
      }

      this.logger.warn(`Image invalid (${validation.reason ?? "parse_failed"}): ${url}`);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Image validation failed for ${url}: ${message}`);
    }

    await unlink(downloadResult.path).catch(() => undefined);
    return { status: "skipped", reason: "invalid_image" };
  }

  private async cleanupTemporarySceneImages(paths: DownloadedSceneImage[]): Promise<void> {
    for (const filePath of paths) {
      await unlink(filePath.path).catch(() => undefined);
    }
  }

  private async getFileSignature(
    filePath: string,
    cache: Map<string, Promise<string | undefined>>,
  ): Promise<string | undefined> {
    let pending = cache.get(filePath);
    if (!pending) {
      pending = buildFileSignature(filePath);
      cache.set(filePath, pending);
    }

    return await pending;
  }

  private isHigherResolutionCandidate(
    candidate: DownloadedImageCandidate,
    currentBest: DownloadedImageCandidate,
  ): boolean {
    const resolutionComparison = this.compareImageResolution(candidate, currentBest);
    return resolutionComparison < 0 || (resolutionComparison === 0 && candidate.rank < currentBest.rank);
  }

  private canSkipCandidateDownload(candidate: ProbedImageCandidate, currentBest: DownloadedImageCandidate): boolean {
    return this.hasProbeDimensions(candidate) && this.compareImageResolution(candidate, currentBest) >= 0;
  }

  private shouldAttemptCandidateDownload(candidate: ProbedImageCandidate): boolean {
    return !(candidate.status > 0 && IMAGE_PROBE_TERMINAL_MISS_STATUS_CODES.has(candidate.status));
  }

  private hasProbeDimensions(candidate: ProbedImageCandidate): candidate is ProbedImageCandidateWithDimensions {
    return (
      typeof candidate.width === "number" &&
      candidate.width > 0 &&
      typeof candidate.height === "number" &&
      candidate.height > 0
    );
  }

  private canSelectBestImageFromProbe(
    candidates: ProbedImageCandidate[],
  ): candidates is ProbedImageCandidateWithDimensions[] {
    return candidates.length > 0 && candidates.every((candidate) => candidate.ok && this.hasProbeDimensions(candidate));
  }

  private compareImageResolution(
    candidate: Pick<DownloadedImageCandidate, "width" | "height">,
    currentBest: Pick<DownloadedImageCandidate, "width" | "height">,
  ): number {
    const candidatePixels = candidate.width * candidate.height;
    const bestPixels = currentBest.width * currentBest.height;

    if (candidatePixels !== bestPixels) {
      return bestPixels - candidatePixels;
    }

    if (candidate.width !== currentBest.width) {
      return currentBest.width - candidate.width;
    }

    if (candidate.height !== currentBest.height) {
      return currentBest.height - candidate.height;
    }

    return 0;
  }

  private compareProbedImageCandidates(a: ProbedImageCandidate, b: ProbedImageCandidate): number {
    const aHasDimensions = this.hasProbeDimensions(a);
    const bHasDimensions = this.hasProbeDimensions(b);

    if (aHasDimensions && bHasDimensions) {
      const resolutionComparison = this.compareImageResolution(a, b);
      if (resolutionComparison !== 0) {
        return resolutionComparison;
      }
    } else if (aHasDimensions !== bHasDimensions) {
      return aHasDimensions ? -1 : 1;
    }

    if (a.ok !== b.ok) {
      return a.ok ? -1 : 1;
    }

    return (b.contentLength ?? 0) - (a.contentLength ?? 0) || a.index - b.index;
  }

  private async orderImageCandidatesByProbe(
    candidates: string[],
    signal?: AbortSignal,
    captureImageSize = false,
  ): Promise<ProbedImageCandidate[]> {
    throwIfAborted(signal);
    const probedCandidates = await Promise.all(
      candidates.map((url, index) => this.probeImageCandidate(url, index, signal, captureImageSize)),
    );

    return [...probedCandidates].sort((a, b) => this.compareProbedImageCandidates(a, b));
  }

  private async probeImageCandidate(
    url: string,
    index: number,
    signal?: AbortSignal,
    captureImageSize = false,
  ): Promise<ProbedImageCandidate> {
    throwIfAborted(signal);
    if (this.shouldSkipUrlForImageHostCooldown(url)) {
      return createFailedProbeCandidate(url, index);
    }

    try {
      const result = await this.networkClient.probe(url, { signal, captureImageSize });
      if (!result.ok && shouldRecordImageHostFailure(result.status)) {
        this.recordImageHostFailure(url, `HTTP ${result.status}`);
      }
      return { ...result, index, url };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const message = toErrorMessage(error);
      this.recordImageHostFailure(url, message);
      return createFailedProbeCandidate(url, index);
    }
  }

  private async copyDerivedImage(sourcePath: string, targetPath: string, targetLabel: string): Promise<string | null> {
    try {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      return targetPath;
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to derive ${targetLabel} image: ${message}`);
      return null;
    }
  }

  private async safeDownload(
    url: string,
    outputPath: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<SafeDownloadResult> {
    throwIfAborted(options.signal);
    if (this.shouldSkipUrlForImageHostCooldown(url)) {
      return { status: "skipped", reason: "host_cooldown" };
    }

    try {
      const downloadedPath = await this.networkClient.download(url, outputPath, {
        timeout: options.timeoutMs,
        signal: options.signal,
      });
      this.resetImageHostFailure(url);
      return { status: "downloaded", path: downloadedPath };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const message = toErrorMessage(error);
      if (shouldRecordImageHostFailure(undefined, message)) {
        this.recordImageHostFailure(url, message);
      }
      this.logger.warn(`Download failed for ${url}: ${message}`);
      return { status: "skipped", reason: "download_failed" };
    }
  }

  private resetImageHostFailure(url: string): void {
    const host = getUrlHost(url);
    if (!host) {
      return;
    }

    this.clearLoggedImageHostCooldown(host);
    this.imageHostCooldownStore.reset(host);
  }

  private recordImageHostFailure(url: string, reason?: string): void {
    const host = getUrlHost(url);
    if (!host) {
      return;
    }

    if (this.isImageHostCoolingDown(host)) {
      return;
    }

    const state = this.imageHostCooldownStore.recordFailure(host, IMAGE_HOST_FAILURE_POLICY);

    if (state?.cooldownUntil) {
      this.logger.warn(
        `Image host cooldown opened for ${host} for ${IMAGE_HOST_COOLDOWN_MS}ms (${formatCooldownDetails(
          state.cooldownUntil,
          Math.max(0, state.cooldownUntil - Date.now()),
        )}) after ${state.failureCount} failures (${reason ?? "request failed"})`,
      );
    }
  }

  private isImageHostCoolingDown(host: string): boolean {
    return this.imageHostCooldownStore.isCoolingDown(host);
  }

  private shouldSkipUrlForImageHostCooldown(url: string): boolean {
    const cooldownState = this.getActiveImageHostCooldown(url);
    if (!cooldownState) {
      const host = getUrlHost(url);
      if (host) {
        this.clearLoggedImageHostCooldown(host);
      }
      return false;
    }

    this.logImageHostCooldownSkip(url, cooldownState.host, cooldownState.activeCooldown);
    return true;
  }

  private getActiveImageHostCooldown(url: string): { host: string; activeCooldown: ActiveCooldown } | null {
    const host = getUrlHost(url);
    if (!host) {
      return null;
    }

    const activeCooldown = this.imageHostCooldownStore.getActiveCooldown(host);
    return activeCooldown ? { host, activeCooldown } : null;
  }

  private logImageHostCooldownSkip(url: string, host: string, activeCooldown: ActiveCooldown): void {
    if (this.loggedCooldownUntilByImageHost.get(host) === activeCooldown.cooldownUntil) {
      return;
    }

    this.loggedCooldownUntilByImageHost.set(host, activeCooldown.cooldownUntil);
    this.logger.info(
      `Skipping ${url}: image host cooldown active for ${host} (${formatCooldownDetails(
        activeCooldown.cooldownUntil,
        activeCooldown.remainingMs,
      )})`,
    );
  }

  private clearLoggedImageHostCooldown(host: string): void {
    this.loggedCooldownUntilByImageHost.delete(host);
  }

  private async listExistingSceneImages(sceneDir: string): Promise<string[]> {
    try {
      const entries = await readdir(sceneDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && SCENE_IMAGE_FILE_PATTERN.test(entry.name))
        .map((entry) => join(sceneDir, entry.name))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  private async removeStaleSceneImages(
    existingPaths: string[],
    activePaths: string[],
    sceneDir: string,
  ): Promise<void> {
    const activeSet = new Set(activePaths);
    const stalePaths = existingPaths.filter((filePath) => !activeSet.has(filePath));

    for (const stalePath of stalePaths) {
      await unlink(stalePath).catch(() => undefined);
    }

    if (stalePaths.length === 0) {
      return;
    }

    try {
      const remaining = await readdir(sceneDir);
      if (remaining.length === 0) {
        await rm(sceneDir, { recursive: true });
      }
    } catch {
      /* directory may not exist */
    }
  }
}
