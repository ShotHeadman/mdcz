import { copyFile, mkdir, readdir, rename, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Configuration } from "@main/services/config";
import { type CooldownFailurePolicy, PersistentCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient, ProbeResult } from "@main/services/network";
import { buildDmmAwsImageCandidates } from "@main/utils/dmmImage";
import { pathExists } from "@main/utils/file";
import { validateImage } from "@main/utils/image";
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
type DownloadedImageCandidate = {
  url: string;
  path: string;
  width: number;
  height: number;
  rank: number;
};
interface DownloadManagerOptions {
  imageHostCooldownStore?: PersistentCooldownStore;
}

const IMAGE_HOST_COOLDOWN_MS = 5 * 60 * 1000;
const SCENE_IMAGE_ATTEMPT_TIMEOUT_MS = 1_500;
const IMAGE_HOST_FAILURE_POLICY: CooldownFailurePolicy = {
  threshold: 2,
  windowMs: IMAGE_HOST_COOLDOWN_MS,
  cooldownMs: IMAGE_HOST_COOLDOWN_MS,
};
const IMAGE_HOST_COOLDOWN_STATUS_CODES = new Set([408, 429]);

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
): string[][] => {
  if (maxSceneImages <= 0) {
    return [];
  }

  const seenSets = new Set<string>();
  const sets: string[][] = [];
  for (const values of [data.sample_images, ...(imageAlternatives.sample_images ?? [])]) {
    const urls = getNormalizedSceneImageUrls(Array.isArray(values) ? values : []).slice(0, maxSceneImages);
    if (urls.length === 0) {
      continue;
    }

    const signature = JSON.stringify(urls);
    if (seenSets.has(signature)) {
      continue;
    }

    seenSets.add(signature);
    sets.push(urls);
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

const buildSceneImageTempFileName = (index: number): string =>
  `.scene-candidate-${String(index + 1).padStart(3, "0")}.jpg`;

const formatCooldownDetails = (cooldownUntil: number, remainingMs: number): string =>
  `${remainingMs}ms remaining until ${new Date(cooldownUntil).toISOString()}`;

const SCENE_IMAGE_FILE_PATTERN = /^(?:scene-\d+|fanart\d+)\.(?:jpe?g|png|webp)$/iu;

export class DownloadManager {
  private readonly logger = loggerService.getLogger("DownloadManager");

  private readonly imageHostCooldownStore: PersistentCooldownStore;

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
        } else {
          const successfulTempPaths = await this.downloadSceneImageSets(
            outputDir,
            config.paths.sceneImagesFolder,
            sceneImageSets,
            targetSceneCount,
            config.download.sceneImageConcurrency,
            callbacks,
          );

          const finalizedSceneCount = Math.min(targetSceneCount, successfulTempPaths.length);
          for (let index = 0; index < finalizedSceneCount; index += 1) {
            const tempPath = successfulTempPaths[index];
            if (!tempPath) {
              continue;
            }

            const finalPath = join(
              outputDir,
              config.paths.sceneImagesFolder,
              buildSceneImageFileName(config.paths.sceneImagesFolder, index),
            );

            await mkdir(dirname(finalPath), { recursive: true });
            await unlink(finalPath).catch(() => undefined);
            if (tempPath !== finalPath) {
              await rename(tempPath, finalPath);
            }
            assets.sceneImages.push(finalPath);
            assets.downloaded.push(finalPath);
          }

          for (let index = finalizedSceneCount; index < successfulTempPaths.length; index += 1) {
            await unlink(successfulTempPaths[index] ?? "").catch(() => undefined);
          }

          if (!forceReplaceSceneImages && finalizedSceneCount === 0) {
            assets.sceneImages.push(...existingSceneImages.slice(0, targetSceneCount));
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
        create: async () => (url ? this.safeDownload(url, trailerPath, { signal: callbacks?.signal }) : null),
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
    sceneImageSets: string[][],
    targetSceneCount: number,
    maxConcurrent: number,
    callbacks?: DownloadCallbacks,
  ): Promise<string[]> {
    if (targetSceneCount <= 0 || sceneImageSets.length === 0) {
      return [];
    }

    for (const [setIndex, urls] of sceneImageSets.entries()) {
      throwIfAborted(callbacks?.signal);
      const attemptedUrls = urls.slice(0, targetSceneCount);
      this.logger.info(
        `Trying scene image set ${setIndex + 1}/${sceneImageSets.length} with ${attemptedUrls.length} image(s)`,
      );

      const downloadedPaths = await this.downloadSceneImageSet(
        outputDir,
        sceneFolder,
        attemptedUrls,
        maxConcurrent,
        callbacks,
      );
      if (downloadedPaths) {
        return downloadedPaths;
      }

      callbacks?.onSceneProgress?.(0, attemptedUrls.length);
      this.logger.info(`Scene image set ${setIndex + 1}/${sceneImageSets.length} failed; trying next set`);
    }

    return [];
  }

  private async downloadSceneImageSet(
    outputDir: string,
    sceneFolder: string,
    urls: string[],
    maxConcurrent: number,
    callbacks?: DownloadCallbacks,
  ): Promise<string[] | null> {
    if (urls.length === 0) {
      return [];
    }

    throwIfAborted(callbacks?.signal);

    const results: Array<string | null> = new Array(urls.length).fill(null);
    const temporaryPaths = new Set<string>();
    const state = {
      nextIndex: 0,
      failed: false,
    };

    const workerCount = Math.min(urls.length, Math.max(1, maxConcurrent));
    const runWorker = async (): Promise<void> => {
      while (!state.failed) {
        throwIfAborted(callbacks?.signal);
        const candidateIndex = state.nextIndex++;
        const url = urls[candidateIndex];
        if (!url) {
          return;
        }

        const tempPath = join(outputDir, sceneFolder, buildSceneImageTempFileName(candidateIndex));
        const downloadedPath = await this.downloadAndValidateImage(url, tempPath, {
          timeoutMs: SCENE_IMAGE_ATTEMPT_TIMEOUT_MS,
          signal: callbacks?.signal,
        });
        if (!downloadedPath) {
          state.failed = true;
          return;
        }

        temporaryPaths.add(downloadedPath);
        results[candidateIndex] = downloadedPath;
        callbacks?.onSceneProgress?.(results.filter((item): item is string => Boolean(item)).length, urls.length);
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
    const downloadedPaths = results.filter((item): item is string => Boolean(item));
    if (state.failed || downloadedPaths.length !== urls.length) {
      for (const filePath of temporaryPaths) {
        await unlink(filePath).catch(() => undefined);
      }
      return null;
    }

    return downloadedPaths;
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
      data.number,
      data.thumb_url,
      imageAlternatives.thumb_url,
      join(outputDir, "thumb.jpg"),
    );
    this.addPrimaryImageTask(
      tasks,
      "poster",
      config.download.downloadPoster,
      config.download.keepPoster,
      data.number,
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
    number: string | undefined,
    primaryUrl: string | undefined,
    alternatives: string[] | undefined,
    path: string,
  ): void {
    if (!enabled) {
      return;
    }

    const candidates = this.buildImageCandidates(primaryUrl, alternatives, number);
    tasks.push({ key, candidates, path, keepExisting });
  }

  private buildImageCandidates(primaryUrl?: string, alternatives?: string[], rawNumber?: string): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];

    for (const url of [primaryUrl, ...(alternatives ?? [])]) {
      const normalized = normalizeUrl(url);
      if (!normalized) {
        continue;
      }

      for (const candidate of [normalized, ...buildDmmAwsImageCandidates(normalized, rawNumber)]) {
        if (seen.has(candidate)) {
          continue;
        }

        seen.add(candidate);
        candidates.push(candidate);
      }
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
          const message = error instanceof Error ? error.message : String(error);
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
    if (this.canSelectBestImageFromProbe(probedCandidates)) {
      for (const candidate of probedCandidates) {
        throwIfAborted(signal);
        const downloadedPath = await this.downloadAndValidateImage(candidate.url, outputPath, { signal });
        if (downloadedPath) {
          return candidate.url;
        }
      }

      return undefined;
    }

    return await this.downloadBestImageByComparison(probedCandidates, outputPath, signal);
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
        if (!downloaded) {
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
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<string | null> {
    const candidate = await this.downloadValidatedImageCandidate(url, outputPath, options);
    return candidate?.path ?? null;
  }

  private async downloadValidatedImageCandidate(
    url: string,
    outputPath: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<{ path: string; width: number; height: number } | null> {
    throwIfAborted(options.signal);
    const downloadedPath = await this.safeDownload(url, outputPath, options);
    if (!downloadedPath) {
      return null;
    }

    try {
      const validation = await validateImage(downloadedPath);
      if (validation.valid) {
        return {
          path: downloadedPath,
          width: validation.width,
          height: validation.height,
        };
      }

      this.logger.warn(`Image invalid (${validation.reason ?? "parse_failed"}): ${url}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Image validation failed for ${url}: ${message}`);
    }

    await unlink(downloadedPath).catch(() => undefined);
    return null;
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
    if (this.isHostCoolingDown(url)) {
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
      const message = error instanceof Error ? error.message : String(error);
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
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to derive ${targetLabel} image: ${message}`);
      return null;
    }
  }

  private async safeDownload(
    url: string,
    outputPath: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<string | null> {
    throwIfAborted(options.signal);
    if (this.isHostCoolingDown(url)) {
      return null;
    }

    try {
      const downloadedPath = await this.networkClient.download(url, outputPath, {
        timeout: options.timeoutMs,
        signal: options.signal,
      });
      this.resetImageHostFailure(url);
      return downloadedPath;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (shouldRecordImageHostFailure(undefined, message)) {
        this.recordImageHostFailure(url, message);
      }
      this.logger.warn(`Download failed for ${url}: ${message}`);
      return null;
    }
  }

  private isHostCoolingDown(url: string): boolean {
    const host = getUrlHost(url);
    if (!host) {
      return false;
    }

    const activeCooldown = this.imageHostCooldownStore.getActiveCooldown(host);
    if (activeCooldown) {
      this.logger.info(
        `Skipping ${url}: image host cooldown active for ${host} (${formatCooldownDetails(
          activeCooldown.cooldownUntil,
          activeCooldown.remainingMs,
        )})`,
      );
    }
    return Boolean(activeCooldown);
  }

  private resetImageHostFailure(url: string): void {
    const host = getUrlHost(url);
    if (!host) {
      return;
    }

    this.imageHostCooldownStore.reset(host);
  }

  private recordImageHostFailure(url: string, reason?: string): void {
    const host = getUrlHost(url);
    if (!host) {
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
