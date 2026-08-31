import { join } from "node:path";

import { throwIfAborted } from "../../utils/abort";
import { normalizeUrl } from "../ImageHostCooldownTracker";
import { resolveSingleAsset, shouldFallbackToExistingAsset, shouldKeepAsset } from "./helpers";
import type { AssetDownloader, DownloadExecutionContext, DownloadExecutionPlan } from "./types";

const TRAILER_TOTAL_TIMEOUT_MS = 30_000;
const TRAILER_READ_TIMEOUT_MS = 10_000;

export class TrailerAssetDownloader implements AssetDownloader {
  shouldDownload(plan: DownloadExecutionPlan): boolean {
    return plan.config.download.downloadTrailer;
  }

  async download(context: DownloadExecutionContext): Promise<void> {
    const { assets, imageDownloader, plan } = context;

    throwIfAborted(plan.signal);

    const trailerPath = join(plan.outputDir, plan.assetFileNames.trailer);
    const url = [plan.data.trailer_source_url, plan.data.trailer_url]
      .map((candidate) => normalizeUrl(candidate))
      .find((candidate): candidate is string => Boolean(candidate));
    const keepTrailer = shouldKeepAsset(plan.assetDecisions.trailer, plan.config.download.keepTrailer);
    const trailerResult = await resolveSingleAsset({
      targetPath: trailerPath,
      keepExisting: keepTrailer,
      fallbackToExistingOnFailure: shouldFallbackToExistingAsset(plan.assetDecisions.trailer),
      create: async () => {
        if (!url) return null;
        const downloadResult = await imageDownloader.downloadFile(url, trailerPath, {
          signal: plan.signal,
          readTimeoutMs: TRAILER_READ_TIMEOUT_MS,
          totalTimeoutMs: TRAILER_TOTAL_TIMEOUT_MS,
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
