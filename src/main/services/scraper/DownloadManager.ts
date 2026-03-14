import { copyFile, mkdir, readdir, rename, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient, ProbeResult } from "@main/services/network";
import { pathExists } from "@main/utils/file";
import { validateImage } from "@main/utils/image";
import type { CrawlerData, DownloadedAssets, MaintenanceAssetDecisions } from "@shared/types";
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
  create,
}: {
  targetPath: string;
  keepExisting: boolean;
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

  return { assetPath: existingPath };
};

/** Optional callbacks for download progress reporting. */
export interface DownloadCallbacks {
  /** Called after each scene image completes (success or fail). */
  onSceneProgress?: (downloaded: number, total: number) => void;
  /** Force a primary image to refresh even when its keep flag is enabled. */
  forceReplace?: Partial<Record<PrimaryImageKey, boolean>>;
  /** Preserve or replace selected maintenance-managed assets regardless of preset keep flags. */
  assetDecisions?: MaintenanceAssetDecisions;
}

type PrimaryImageKey = keyof Pick<DownloadedAssets, "thumb" | "poster" | "fanart">;
type PrimaryImageTask = { key: PrimaryImageKey; candidates: string[]; path: string; keepExisting: boolean };
type SceneImageTask = { key: "sceneImages"; path: string; url: string };
type ParallelResult<K extends string, TValue> = { key: K; path: string; success: boolean; value?: TValue };
type ProbedImageCandidate = ProbeResult & { index: number; url: string };

const getPrimaryFanartFallbackUrl = (data: CrawlerData): string | undefined => {
  if (data.fanart_url) {
    return undefined;
  }

  return normalizeUrl(data.thumb_url) ?? undefined;
};

const getPrimaryFanartAlternativeUrls = (
  data: CrawlerData,
  imageAlternatives: Partial<ImageAlternatives>,
): string[] => {
  if (data.fanart_url) {
    return imageAlternatives.fanart_url ?? [];
  }

  return [
    getPrimaryFanartFallbackUrl(data),
    ...(imageAlternatives.fanart_url ?? []),
    ...(imageAlternatives.thumb_url ?? []),
  ].filter((item): item is string => typeof item === "string");
};

const getSceneImageUrls = (data: CrawlerData, maxSceneImages: number): string[] => {
  return data.sample_images
    .map((item) => normalizeUrl(item))
    .filter((item): item is string => !!item)
    .slice(0, maxSceneImages);
};

const toSceneDownloadResult = async (download: Promise<unknown>): Promise<true | undefined> => {
  return (await download) ? true : undefined;
};

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

const SCENE_IMAGE_FILE_PATTERN = /^(?:scene-\d+|fanart\d+)\.(?:jpe?g|png|webp)$/iu;

export class DownloadManager {
  private readonly logger = loggerService.getLogger("DownloadManager");

  constructor(private readonly networkClient: NetworkClient) {}

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

    const forceReplace = callbacks?.forceReplace ?? {};
    const assetDecisions = callbacks?.assetDecisions ?? {};
    const primaryTasks = this.buildPrimaryImageTasks(outputDir, data, config, imageAlternatives);
    const pendingPrimaryTasks: PrimaryImageTask[] = [];

    for (const task of primaryTasks) {
      const existingAsset = await resolveExistingAsset(task.path);
      const keepExisting =
        task.key === "fanart"
          ? assetDecisions.fanart === "preserve"
            ? true
            : assetDecisions.fanart === "replace"
              ? false
              : task.keepExisting
          : task.keepExisting;

      if (keepExisting && existingAsset && !forceReplace[task.key]) {
        assets[task.key] = existingAsset;
        continue;
      }

      if (task.candidates.length > 0) {
        pendingPrimaryTasks.push(task);
      }
    }

    const primaryResults = await this.runParallel(pendingPrimaryTasks, 3, async (task) => {
      return await this.downloadBestImage(task.candidates, task.path);
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
        const urls = getSceneImageUrls(data, config.aggregation.behavior.maxSceneImages);

        if (urls.length === 0) {
          if (forceReplaceSceneImages && existingSceneImages.length > 0) {
            await this.removeStaleSceneImages(existingSceneImages, [], sceneDir);
          } else {
            assets.sceneImages.push(...existingSceneImages);
          }
        } else {
          const sceneTasks: SceneImageTask[] = urls.map((url, index) => ({
            url,
            path: join(
              outputDir,
              config.paths.sceneImagesFolder,
              buildSceneImageFileName(config.paths.sceneImagesFolder, index),
            ),
            key: "sceneImages" as const,
          }));

          let sceneCompleted = 0;
          const sceneResults = await this.runParallel(
            sceneTasks,
            config.download.sceneImageConcurrency,
            async (task) => toSceneDownloadResult(this.downloadAndValidateImage(task.url, task.path)),
            () => {
              sceneCompleted++;
              callbacks?.onSceneProgress?.(sceneCompleted, sceneTasks.length);
            },
          );

          const existingSceneSet = new Set(existingSceneImages);
          for (const [index, result] of sceneResults.entries()) {
            const task = sceneTasks[index];
            if (!task) {
              continue;
            }

            if (result?.success) {
              assets.sceneImages.push(result.path);
              assets.downloaded.push(result.path);
              continue;
            }

            if (existingSceneSet.has(task.path)) {
              assets.sceneImages.push(task.path);
            }
          }

          if (assets.sceneImages.length > 0) {
            await this.removeStaleSceneImages(existingSceneImages, assets.sceneImages, sceneDir);
          }
        }
      }
    }

    if (config.download.downloadFanart && !assets.fanart && assets.thumb) {
      const thumbPath = assets.thumb;
      const fanartTargetPath = join(outputDir, "fanart.jpg");
      const fanartResult = await resolveSingleAsset({
        targetPath: fanartTargetPath,
        keepExisting: config.download.keepFanart,
        create: () => this.copyDerivedImage(thumbPath, fanartTargetPath, "fanart"),
      });
      if (fanartResult.assetPath) {
        assets.fanart = fanartResult.assetPath;
        if (fanartResult.createdPath) {
          assets.downloaded.push(fanartResult.createdPath);
        }
      }
    }

    if (config.download.downloadTrailer) {
      const trailerPath = join(outputDir, "trailer.mp4");
      const url = normalizeUrl(data.trailer_url);
      const trailerResult = await resolveSingleAsset({
        targetPath: trailerPath,
        keepExisting: config.download.keepTrailer,
        create: async () => (url ? this.safeDownload(url, trailerPath) : null),
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
    this.addPrimaryImageTask(
      tasks,
      "fanart",
      config.download.downloadFanart,
      config.download.keepFanart,
      data.fanart_url,
      getPrimaryFanartAlternativeUrls(data, imageAlternatives),
      join(outputDir, "fanart.jpg"),
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
    let completed = 0;
    let running = 0;
    let nextIndex = 0;

    if (tasks.length === 0) return results;

    return new Promise((resolve) => {
      const tryLaunchNext = (): void => {
        while (running < maxConcurrent && nextIndex < tasks.length) {
          const taskIndex = nextIndex++;
          const task = tasks[taskIndex];
          running++;

          runner(task)
            .then((value) => {
              results[taskIndex] = {
                key: task.key,
                path: task.path,
                success: value !== undefined,
                value,
              };
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              this.logger.warn(`Parallel task failed for ${task.path}: ${message}`);
              results[taskIndex] = { key: task.key, path: task.path, success: false };
            })
            .finally(() => {
              completed += 1;
              running--;
              onItemComplete?.();
              if (completed === tasks.length) {
                resolve(results);
              } else {
                tryLaunchNext();
              }
            });
        }
      };

      tryLaunchNext();
    });
  }

  private async downloadBestImage(candidates: string[], outputPath: string): Promise<string | undefined> {
    if (candidates.length === 0) {
      return undefined;
    }

    for (const url of await this.orderImageCandidatesByProbe(candidates)) {
      const downloadedPath = await this.downloadAndValidateImage(url, outputPath);
      if (downloadedPath) {
        return url;
      }
    }

    return undefined;
  }

  private async downloadAndValidateImage(url: string, outputPath: string): Promise<string | null> {
    const tempPath = `${outputPath}.part`;
    const downloadedPath = await this.safeDownload(url, tempPath);
    if (!downloadedPath) {
      return null;
    }

    try {
      const validation = await validateImage(tempPath);
      if (validation.valid) {
        await unlink(outputPath).catch(() => undefined);
        await rename(tempPath, outputPath);
        return outputPath;
      }

      this.logger.warn(`Image invalid (${validation.reason ?? "parse_failed"}): ${url}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Image validation failed for ${url}: ${message}`);
    }

    await unlink(tempPath).catch(() => undefined);
    return null;
  }

  private async orderImageCandidatesByProbe(candidates: string[]): Promise<string[]> {
    const probedCandidates = await Promise.all(candidates.map((url, index) => this.probeImageCandidate(url, index)));
    const successfulUrls = probedCandidates
      .filter((candidate) => candidate.ok)
      .sort((a, b) => (b.contentLength ?? 0) - (a.contentLength ?? 0) || a.index - b.index)
      .map((candidate) => candidate.url);

    const attemptedUrls = new Set(successfulUrls);
    return [...successfulUrls, ...candidates.filter((url) => !attemptedUrls.has(url))];
  }

  private async probeImageCandidate(url: string, index: number): Promise<ProbedImageCandidate> {
    try {
      const result = await this.networkClient.probe(url);
      return { ...result, index, url };
    } catch {
      return {
        url,
        index,
        ok: false,
        contentLength: null,
        status: 0,
        resolvedUrl: url,
      };
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

  private async safeDownload(url: string, outputPath: string): Promise<string | null> {
    try {
      return await this.networkClient.download(url, outputPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Download failed for ${url}: ${message}`);
      return null;
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
