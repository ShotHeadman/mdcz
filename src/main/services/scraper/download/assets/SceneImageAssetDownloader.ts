import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { throwIfAborted } from "../../abort";
import {
  buildSceneImageFileName,
  getSceneImageSets,
  listExistingSceneImages,
  removeStaleSceneImages,
  resolveExistingImageAsset,
  shouldKeepAsset,
  uniqueFilePaths,
} from "./helpers";
import type { AssetDownloader, DownloadExecutionContext, DownloadExecutionPlan } from "./types";

export class SceneImageAssetDownloader implements AssetDownloader {
  shouldDownload(plan: DownloadExecutionPlan): boolean {
    return plan.config.download.downloadSceneImages;
  }

  async download(context: DownloadExecutionContext): Promise<void> {
    const { assets, plan, sceneImageDownloader } = context;

    throwIfAborted(plan.signal);

    const sceneDir = join(plan.outputDir, plan.config.paths.sceneImagesFolder);
    const existingSceneImages = await listExistingSceneImages(sceneDir);
    const sceneImageComparisonPaths = uniqueFilePaths([
      assets.thumb,
      await resolveExistingImageAsset(join(plan.outputDir, plan.assetFileNames.fanart)),
    ]);
    const forceReplaceSceneImages = plan.assetDecisions.sceneImages === "replace";
    const keepSceneImages = shouldKeepAsset(plan.assetDecisions.sceneImages, plan.config.download.keepSceneImages);

    if (keepSceneImages && existingSceneImages.length > 0) {
      assets.sceneImages.push(...existingSceneImages);
      return;
    }

    throwIfAborted(plan.signal);

    const targetSceneCount = Math.max(0, plan.config.aggregation.behavior.maxSceneImages);
    const sceneImageSets = getSceneImageSets(plan.data, plan.imageAlternatives, targetSceneCount);

    if (sceneImageSets.length === 0) {
      await this.handleMissingSceneImageSets(plan, assets, existingSceneImages, forceReplaceSceneImages, sceneDir);
      return;
    }

    const successfulSceneImages = await sceneImageDownloader.downloadSceneImageSets({
      outputDir: plan.outputDir,
      sceneFolder: plan.config.paths.sceneImagesFolder,
      sceneImageSets,
      targetSceneCount,
      maxConcurrent: plan.config.download.sceneImageConcurrency,
      dedupeAgainstPaths: sceneImageComparisonPaths,
      signal: plan.signal,
      onSceneProgress: plan.callbacks?.onSceneProgress,
    });

    const finalizedSceneCount = Math.min(targetSceneCount, successfulSceneImages.length);
    for (let index = 0; index < finalizedSceneCount; index += 1) {
      const sceneImage = successfulSceneImages[index];
      if (!sceneImage) {
        continue;
      }

      const finalPath = join(
        plan.outputDir,
        plan.config.paths.sceneImagesFolder,
        buildSceneImageFileName(plan.config.paths.sceneImagesFolder, index, sceneImage.path),
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

    this.reportResolvedSceneImageUrls(
      plan,
      successfulSceneImages,
      finalizedSceneCount,
      existingSceneImages,
      forceReplaceSceneImages,
    );

    if (assets.sceneImages.length > 0 || forceReplaceSceneImages) {
      await removeStaleSceneImages(existingSceneImages, assets.sceneImages, sceneDir);
    }
  }

  private async handleMissingSceneImageSets(
    plan: DownloadExecutionPlan,
    assets: DownloadExecutionContext["assets"],
    existingSceneImages: string[],
    forceReplaceSceneImages: boolean,
    sceneDir: string,
  ): Promise<void> {
    if (forceReplaceSceneImages && existingSceneImages.length > 0) {
      await removeStaleSceneImages(existingSceneImages, [], sceneDir);
    } else {
      assets.sceneImages.push(...existingSceneImages);
    }

    if (existingSceneImages.length > 0 && !forceReplaceSceneImages) {
      plan.callbacks?.onResolvedSceneImageUrls?.(undefined);
      return;
    }

    plan.callbacks?.onResolvedSceneImageUrls?.([]);
  }

  private reportResolvedSceneImageUrls(
    plan: DownloadExecutionPlan,
    successfulSceneImages: Array<{ path: string; url: string }>,
    finalizedSceneCount: number,
    existingSceneImages: string[],
    forceReplaceSceneImages: boolean,
  ): void {
    if (finalizedSceneCount > 0) {
      plan.callbacks?.onResolvedSceneImageUrls?.(
        successfulSceneImages.slice(0, finalizedSceneCount).map((item) => item.url),
      );
      return;
    }

    if (!forceReplaceSceneImages && existingSceneImages.length > 0) {
      plan.callbacks?.onResolvedSceneImageUrls?.(undefined);
      return;
    }

    plan.callbacks?.onResolvedSceneImageUrls?.([]);
  }
}
