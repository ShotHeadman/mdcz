import { join } from "node:path";

import { throwIfAborted } from "../../utils/abort";
import { buildImageAssetPathFromSource, resolveExistingImageAsset, shouldKeepAsset } from "./helpers";
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
      const keepFanart = shouldKeepAsset(
        plan.assetDecisions.fanart,
        thumbWasRefreshed ? false : plan.config.download.keepFanart,
      );
      const fanartPath = buildImageAssetPathFromSource(fanartTargetPath, thumbPath);
      const existingFanart = await resolveExistingImageAsset(
        plan.existingAssets?.fanart ??
          buildImageAssetPathFromSource(join(plan.existingAssetDir, plan.assetFileNames.fanart), thumbPath),
        plan.inventory,
      );

      if (keepFanart && existingFanart) {
        assets.fanart = existingFanart;
        return;
      }

      const createdPath = await imageDownloader.copyDerivedImage(thumbPath, fanartPath, "fanart");
      if (createdPath) {
        assets.fanart = createdPath;
        assets.downloaded.push(createdPath);
        return;
      }

      if (existingFanart && plan.assetDecisions.fanart !== "replace") {
        assets.fanart = existingFanart;
      }
      return;
    }

    const existingFanart = await resolveExistingImageAsset(
      plan.existingAssets?.fanart ?? join(plan.existingAssetDir, plan.assetFileNames.fanart),
      plan.inventory,
    );
    if (existingFanart && plan.assetDecisions.fanart !== "replace") {
      assets.fanart = existingFanart;
    }
  }
}
