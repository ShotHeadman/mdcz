import { join } from "node:path";

import { throwIfAborted } from "../../abort";
import { buildImageCandidates, resolveExistingAsset, runParallel } from "./helpers";
import type { AssetDownloader, DownloadExecutionContext, DownloadExecutionPlan, PrimaryImageKey } from "./types";

type PrimaryImageTask = { key: PrimaryImageKey; candidates: string[]; path: string; keepExisting: boolean };

export class PrimaryImageAssetDownloader implements AssetDownloader {
  shouldDownload(plan: DownloadExecutionPlan): boolean {
    return plan.config.download.downloadThumb || plan.config.download.downloadPoster;
  }

  async download(context: DownloadExecutionContext): Promise<void> {
    const { assets, imageDownloader, logger, plan } = context;

    throwIfAborted(plan.signal);

    const primaryTasks = this.buildPrimaryImageTasks(plan);
    const pendingPrimaryTasks: PrimaryImageTask[] = [];

    for (const task of primaryTasks) {
      const existingAsset = await resolveExistingAsset(task.path);
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
      assets[key] = result.path;
      assets.downloaded.push(result.path);
    }

    for (const task of primaryTasks) {
      if (!assets[task.key]) {
        const existingAsset = await resolveExistingAsset(task.path);
        if (existingAsset) {
          assets[task.key] = existingAsset;
        }
      }
    }
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
      join(plan.outputDir, "thumb.jpg"),
    );
    this.addPrimaryImageTask(
      tasks,
      "poster",
      plan.config.download.downloadPoster,
      plan.config.download.keepPoster,
      plan.data.poster_url,
      plan.imageAlternatives.poster_url,
      join(plan.outputDir, "poster.jpg"),
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
}
