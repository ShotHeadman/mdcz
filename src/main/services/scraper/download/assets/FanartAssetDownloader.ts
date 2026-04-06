import { join } from "node:path";

import { throwIfAborted } from "../../abort";
import { resolveExistingAsset, resolveSingleAsset, shouldKeepAsset } from "./helpers";
import type { AssetDownloader, DownloadExecutionContext, DownloadExecutionPlan } from "./types";

export class FanartAssetDownloader implements AssetDownloader {
  shouldDownload(plan: DownloadExecutionPlan): boolean {
    return plan.config.download.downloadFanart;
  }

  async download(context: DownloadExecutionContext): Promise<void> {
    const { assets, imageDownloader, plan } = context;

    throwIfAborted(plan.signal);

    const fanartTargetPath = join(plan.outputDir, "fanart.jpg");
    const thumbPath = assets.thumb;

    if (thumbPath) {
      const thumbWasRefreshed = assets.downloaded.includes(thumbPath) || plan.forceReplace.fanart;
      const keepFanart = thumbWasRefreshed
        ? false
        : shouldKeepAsset(plan.assetDecisions.fanart, plan.config.download.keepFanart);

      const fanartResult = await resolveSingleAsset({
        targetPath: fanartTargetPath,
        keepExisting: keepFanart,
        create: () => imageDownloader.copyDerivedImage(thumbPath, fanartTargetPath, "fanart"),
      });
      if (fanartResult.assetPath) {
        assets.fanart = fanartResult.assetPath;
        if (fanartResult.createdPath) {
          assets.downloaded.push(fanartResult.createdPath);
        }
      }
      return;
    }

    const existingFanart = await resolveExistingAsset(fanartTargetPath);
    if (existingFanart) {
      assets.fanart = existingFanart;
    }
  }
}
