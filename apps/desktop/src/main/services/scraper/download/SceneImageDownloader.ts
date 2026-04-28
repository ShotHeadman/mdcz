import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Website } from "@mdcz/shared/enums";
import { throwIfAborted } from "../abort";
import type { ImageDownloadService } from "./ImageDownloadService";
import { getUrlHost, type ImageHostCooldownTracker } from "./ImageHostCooldownTracker";

interface DownloadLogger {
  info(message: string): void;
}

export type SceneImageSet = { urls: string[]; source?: Website };
export type DownloadedSceneImage = {
  path: string;
  url: string;
};

type SceneImageCandidate = { index: number; url: string; host: string | null };

const SCENE_IMAGE_ATTEMPT_TIMEOUT_MS = 3_000;
const SCENE_IMAGE_MIN_BYTES = 4_096;

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

const formatSceneImageSetDetails = (sceneImageSet: SceneImageSet): string => {
  const hosts = Array.from(
    new Set(sceneImageSet.urls.map((url) => getUrlHost(url)).filter((host): host is string => Boolean(host))),
  );
  const source = sceneImageSet.source ?? "unknown";
  const firstHost = hosts[0] ?? "unknown";
  const hostDetail = hosts.length <= 1 ? firstHost : `${firstHost}; ${hosts.length} hosts`;
  return `source=${source}, firstHost=${hostDetail}`;
};

export class SceneImageDownloader {
  constructor(
    private readonly imageDownloader: ImageDownloadService,
    private readonly hostCooldown: ImageHostCooldownTracker,
    private readonly logger: DownloadLogger,
  ) {}

  async downloadSceneImageSets(input: {
    outputDir: string;
    sceneFolder: string;
    sceneImageSets: SceneImageSet[];
    targetSceneCount: number;
    maxConcurrent: number;
    dedupeAgainstPaths: string[];
    signal?: AbortSignal;
    onSceneProgress?: (downloaded: number, total: number) => void;
  }): Promise<DownloadedSceneImage[]> {
    if (input.targetSceneCount <= 0 || input.sceneImageSets.length === 0) {
      return [];
    }

    let bestPaths: DownloadedSceneImage[] = [];

    for (const [setIndex, sceneImageSet] of input.sceneImageSets.entries()) {
      throwIfAborted(input.signal);
      const attemptedUrls = this.hostCooldown.filterUrls(sceneImageSet.urls.slice(0, input.targetSceneCount));
      const setDetails = formatSceneImageSetDetails(sceneImageSet);

      if (attemptedUrls.length === 0) {
        this.logger.info(
          `Skipping scene image set ${setIndex + 1}/${input.sceneImageSets.length} (${setDetails}): all image hosts are cooling down`,
        );
        continue;
      }

      this.logger.info(
        `Trying scene image set ${setIndex + 1}/${input.sceneImageSets.length} (${setDetails}) with ${attemptedUrls.length} image(s)`,
      );

      const downloadedPaths = await this.downloadSceneImageSet({
        outputDir: input.outputDir,
        sceneFolder: input.sceneFolder,
        setIndex,
        urls: attemptedUrls,
        maxConcurrent: input.maxConcurrent,
        dedupeAgainstPaths: input.dedupeAgainstPaths,
        signal: input.signal,
        onSceneProgress: input.onSceneProgress,
      });

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

      input.onSceneProgress?.(0, attemptedUrls.length);
      this.logger.info(
        `Scene image set ${setIndex + 1}/${input.sceneImageSets.length} (${setDetails}) incomplete (${downloadedPaths.length}/${attemptedUrls.length}); trying next set`,
      );
    }

    return bestPaths;
  }

  private async downloadSceneImageSet(input: {
    outputDir: string;
    sceneFolder: string;
    setIndex: number;
    urls: string[];
    maxConcurrent: number;
    dedupeAgainstPaths: string[];
    signal?: AbortSignal;
    onSceneProgress?: (downloaded: number, total: number) => void;
  }): Promise<DownloadedSceneImage[]> {
    if (input.urls.length === 0) {
      return [];
    }

    throwIfAborted(input.signal);

    const results: Array<DownloadedSceneImage | null> = new Array(input.urls.length).fill(null);
    const temporaryPaths = new Set<string>();
    const coolingHosts = new Set<string>();
    const signatureCache = new Map<string, Promise<string | undefined>>();
    const seenSignatures = new Set<string>(
      (
        await Promise.all(
          input.dedupeAgainstPaths.map(async (filePath) => await this.getFileSignature(filePath, signatureCache)),
        )
      ).filter((value): value is string => Boolean(value)),
    );
    let abandonSet = false;
    let nextIndex = 0;
    const hostCount = new Set(input.urls.map((url) => getUrlHost(url) ?? url)).size;
    const workerCount = Math.min(input.urls.length, Math.max(1, Math.min(input.maxConcurrent, hostCount)));
    const runWorker = async (): Promise<void> => {
      while (true) {
        throwIfAborted(input.signal);
        if (abandonSet) {
          return;
        }

        const candidate = this.getNextSceneImageCandidate(input.urls, () => nextIndex++, coolingHosts);
        if (!candidate) {
          return;
        }

        const tempPath = join(
          input.outputDir,
          input.sceneFolder,
          buildSceneImageTempFileName(input.setIndex, candidate.index),
        );
        const downloadResult = await this.imageDownloader.downloadValidatedImageCandidate(candidate.url, tempPath, {
          timeoutMs: SCENE_IMAGE_ATTEMPT_TIMEOUT_MS,
          minBytes: SCENE_IMAGE_MIN_BYTES,
          signal: input.signal,
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
        input.onSceneProgress?.(
          results.filter((item): item is DownloadedSceneImage => Boolean(item)).length,
          input.urls.length,
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

      if (this.hostCooldown.shouldSkipUrl(url)) {
        if (host) {
          coolingHosts.add(host);
        }
        continue;
      }

      return { index, url, host };
    }
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
}
