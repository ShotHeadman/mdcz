import { join } from "node:path";

import { throwIfAborted } from "../../abort";
import { PosterImageDerivationService } from "../PosterImageDerivationService";
import { buildImageCandidates, removeStaleImageAssetVariants, resolveExistingImageAsset, runParallel } from "./helpers";
import type { AssetDownloader, DownloadExecutionContext, DownloadExecutionPlan, PrimaryImageKey } from "./types";

type PrimaryImageTask = { key: PrimaryImageKey; candidates: string[]; path: string; keepExisting: boolean };

export class PrimaryImageAssetDownloader implements AssetDownloader {
  constructor(private readonly posterDerivationService?: PosterImageDerivationService) {}

  shouldDownload(plan: DownloadExecutionPlan): boolean {
    return plan.config.download.downloadThumb || plan.config.download.downloadPoster;
  }

  async download(context: DownloadExecutionContext): Promise<void> {
    const { assets, imageDownloader, logger, plan } = context;

    throwIfAborted(plan.signal);

    const primaryTasks = this.buildPrimaryImageTasks(plan);
    const pendingPrimaryTasks: PrimaryImageTask[] = [];

    for (const task of primaryTasks) {
      const existingAsset = await resolveExistingImageAsset(task.path);
      if (task.keepExisting && existingAsset && !plan.forceReplace[task.key]) {
        assets[task.key] = existingAsset;
        continue;
      }

      if (task.candidates.length > 0) {
        pendingPrimaryTasks.push(task);
      }
    }

    const primaryResults = await runParallel(
      pendingPrimaryTasks,
      3,
      async (task) => {
        return await imageDownloader.downloadBestImage(task.candidates, task.path, plan.signal);
      },
      {
        warn: (message) => logger.warn(message),
      },
    );

    for (const result of primaryResults) {
      if (!result?.success) {
        continue;
      }

      const key = result.key as PrimaryImageKey;
      const downloadedPath = result.value ?? result.path;
      assets[key] = downloadedPath;
      assets.downloaded.push(downloadedPath);
      await removeStaleImageAssetVariants(result.path, downloadedPath);
    }

    for (const task of primaryTasks) {
      if (!assets[task.key]) {
        const existingAsset = await resolveExistingImageAsset(task.path);
        if (existingAsset) {
          assets[task.key] = existingAsset;
        }
      }
    }

    await this.deriveSmallPosterFromThumb(context);
  }

  private buildPrimaryImageTasks(plan: DownloadExecutionPlan): PrimaryImageTask[] {
    const tasks: PrimaryImageTask[] = [];

    this.addPrimaryImageTask(
      tasks,
      "thumb",
      plan.config.download.downloadThumb,
      plan.config.download.keepThumb,
      plan.data.thumb_url,
      plan.imageAlternatives.thumb_url,
      join(plan.outputDir, plan.assetFileNames.thumb),
    );
    this.addPrimaryImageTask(
      tasks,
      "poster",
      plan.config.download.downloadPoster,
      plan.config.download.keepPoster,
      plan.data.poster_url,
      plan.imageAlternatives.poster_url,
      join(plan.outputDir, plan.assetFileNames.poster),
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

    tasks.push({
      key,
      candidates: buildImageCandidates(primaryUrl, alternatives),
      path,
      keepExisting,
    });
  }

  private async deriveSmallPosterFromThumb(context: DownloadExecutionContext): Promise<void> {
    const { assets, logger, plan } = context;
    if (!plan.config.download.downloadPoster) {
      return;
    }

    throwIfAborted(plan.signal);

    const posterTargetPath = join(plan.outputDir, plan.assetFileNames.poster);
    const service = this.posterDerivationService ?? new PosterImageDerivationService(logger);
    const result = await service.deriveFromThumbIfNeeded({
      posterPath: assets.poster,
      targetPath: posterTargetPath,
      thumbPath: assets.thumb,
    });

    if (result.status !== "derived") {
      return;
    }

    assets.poster = result.path;
    if (!assets.downloaded.includes(result.path)) {
      assets.downloaded.push(result.path);
    }
    await removeStaleImageAssetVariants(posterTargetPath, result.path);

    const thumbSourceUrl = plan.data.thumb_source_url ?? plan.data.thumb_url;
    if (thumbSourceUrl) {
      plan.data.poster_source_url = thumbSourceUrl;
    }
  }
}
