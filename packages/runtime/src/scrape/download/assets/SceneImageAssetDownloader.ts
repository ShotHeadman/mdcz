import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { atomicCopyFile } from "@mdcz/media-store";

import type { DirectoryInventory } from "../../DirectoryInventory";
import { throwIfAborted } from "../../utils/abort";
import {
  buildSceneImageFileName,
  getSceneImageSets,
  resolveExistingImageAsset,
  SCENE_IMAGE_FILE_PATTERN,
  shouldKeepAsset,
  uniqueFilePaths,
} from "./helpers";
import type { AssetDownloader, DownloadExecutionContext, DownloadExecutionPlan } from "./types";

const listExistingSceneImages = async (sceneDir: string, inventory: DirectoryInventory): Promise<string[]> =>
  (await inventory.entries(sceneDir))
    .filter((entry) => entry.isFile() && SCENE_IMAGE_FILE_PATTERN.test(entry.name))
    .map((entry) => join(sceneDir, entry.name))
    .sort((a, b) => a.localeCompare(b));

export class SceneImageAssetDownloader implements AssetDownloader {
  shouldDownload(plan: DownloadExecutionPlan): boolean {
    return plan.config.download.downloadSceneImages;
  }

  async download(context: DownloadExecutionContext): Promise<void> {
    const { assets, logger, plan, sceneImageDownloader } = context;

    throwIfAborted(plan.signal);

    const sceneDir = join(plan.outputDir, plan.config.paths.sceneImagesFolder);
    const forceReplaceSceneImages = plan.assetDecisions.sceneImages === "replace";
    const keepSceneImages = shouldKeepAsset(plan.assetDecisions.sceneImages, plan.config.download.keepSceneImages);

    if (keepSceneImages) {
      const preservedSceneImages =
        plan.existingAssets?.sceneImages ??
        (await listExistingSceneImages(
          join(plan.existingAssetDir, plan.config.paths.sceneImagesFolder),
          plan.inventory,
        ));
      if (preservedSceneImages.length > 0) {
        assets.sceneImages.push(...preservedSceneImages);
        return;
      }
    }

    throwIfAborted(plan.signal);

    const existingSceneImages = await listExistingSceneImages(sceneDir, plan.inventory);
    const sceneImageComparisonPaths = uniqueFilePaths([
      assets.thumb,
      plan.existingAssets?.fanart ??
        (await resolveExistingImageAsset(join(plan.existingAssetDir, plan.assetFileNames.fanart), plan.inventory)),
    ]);
    const targetSceneCount = Math.max(0, plan.config.aggregation.behavior.maxSceneImages);
    const sceneImageSets = getSceneImageSets(plan.data, plan.imageAlternatives, targetSceneCount);

    if (sceneImageSets.length === 0) {
      if (!forceReplaceSceneImages) assets.sceneImages.push(...existingSceneImages);
      plan.callbacks?.onResolvedSceneImageUrls?.(
        existingSceneImages.length && !forceReplaceSceneImages ? undefined : [],
      );
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

      if (sceneImage.path !== finalPath) {
        await atomicCopyFile(sceneImage.path, finalPath);
        await unlink(sceneImage.path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            logger.warn(`Published scene image but failed to remove temporary source ${sceneImage.path}`);
          }
        });
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
