import { join } from "node:path";

import { throwIfAborted } from "../../abort";
import {
  buildImageAssetPathFromSource,
  removeStaleImageAssetVariants,
  resolveExistingImageAsset,
  shouldKeepAsset,
} from "./helpers";
import type { AssetDownloader, DownloadExecutionContext, DownloadExecutionPlan } from "./types";

export class FanartAssetDownloader implements AssetDownloader {
  shouldDownload(plan: DownloadExecutionPlan): boolean {
    return plan.config.download.downloadFanart;
  }

  async download(context: DownloadExecutionContext): Promise<void> {
    const { assets, imageDownloader, plan } = context;

    throwIfAborted(plan.signal);

    const fanartTargetPath = join(plan.outputDir, plan.assetFileNames.fanart);
    const thumbPath = assets.thumb;

    if (thumbPath) {
      const thumbWasRefreshed = assets.downloaded.includes(thumbPath) || plan.forceReplace.fanart;
      const keepFanart = thumbWasRefreshed
        ? false
        : shouldKeepAsset(plan.assetDecisions.fanart, plan.config.download.keepFanart);
      const fanartPath = buildImageAssetPathFromSource(fanartTargetPath, thumbPath);
      const existingFanart = await resolveExistingImageAsset(fanartPath);

      if (keepFanart && existingFanart) {
        assets.fanart = existingFanart;
        return;
      }

      const createdPath = await imageDownloader.copyDerivedImage(thumbPath, fanartPath, "fanart");
      if (createdPath) {
        assets.fanart = createdPath;
        assets.downloaded.push(createdPath);
        await removeStaleImageAssetVariants(fanartTargetPath, createdPath);
        return;
      }

      if (existingFanart) {
        assets.fanart = existingFanart;
      }
      return;
    }

    const existingFanart = await resolveExistingImageAsset(fanartTargetPath);
    if (existingFanart) {
      assets.fanart = existingFanart;
    }
  }
}
