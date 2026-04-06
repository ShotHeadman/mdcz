import { join } from "node:path";

import { throwIfAborted } from "../../abort";
import { normalizeUrl } from "../ImageHostCooldownTracker";
import { resolveSingleAsset, shouldFallbackToExistingAsset, shouldKeepAsset } from "./helpers";
import type { AssetDownloader, DownloadExecutionContext, DownloadExecutionPlan } from "./types";

export class TrailerAssetDownloader implements AssetDownloader {
  shouldDownload(plan: DownloadExecutionPlan): boolean {
    return plan.config.download.downloadTrailer;
  }

  async download(context: DownloadExecutionContext): Promise<void> {
    const { assets, imageDownloader, plan } = context;

    throwIfAborted(plan.signal);

    const trailerPath = join(plan.outputDir, "trailer.mp4");
    const url = normalizeUrl(plan.data.trailer_url);
    const keepTrailer = shouldKeepAsset(plan.assetDecisions.trailer, plan.config.download.keepTrailer);
    const trailerResult = await resolveSingleAsset({
      targetPath: trailerPath,
      keepExisting: keepTrailer,
      fallbackToExistingOnFailure: shouldFallbackToExistingAsset(plan.assetDecisions.trailer),
      create: async () => {
        if (!url) {
          return null;
        }

        const downloadResult = await imageDownloader.downloadFile(url, trailerPath, {
          signal: plan.signal,
        });
        return downloadResult.status === "downloaded" ? downloadResult.path : null;
      },
    });

    if (trailerResult.assetPath) {
      assets.trailer = trailerResult.assetPath;
      if (trailerResult.createdPath) {
        assets.downloaded.push(trailerResult.createdPath);
      }
    }
  }
}
