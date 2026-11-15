import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { CrawlerData, DownloadedAssets, FileInfo, NfoLocalState } from "@mdcz/shared/types";
import type { RuntimeScrapeSignalService } from "../FileScraper";
import { PosterWatermarkService } from "../PosterWatermarkService";
import { hashPosterFile, resolvePosterBadgeStamp } from "../posterBadges";
import { throwIfAborted } from "../utils/abort";

/** Badges go only on a poster this run produced, so they never stack; the record says what the file carries. */
export const applyPosterTagBadgesIfNeeded = async (input: {
  assets: DownloadedAssets;
  config: Pick<Configuration, "download">;
  crawlerData: CrawlerData;
  dataDir: string;
  fileInfo: FileInfo;
  localState?: NfoLocalState;
  logger: { warn(message: string): void };
  signal?: AbortSignal;
  signalService?: Pick<RuntimeScrapeSignalService, "showLogText">;
  watermarkService?: Pick<PosterWatermarkService, "applyTagBadges">;
}): Promise<DownloadedAssets> => {
  const posterPath = input.assets.poster;
  if (!posterPath || !input.assets.downloaded.includes(posterPath)) {
    return input.assets;
  }

  const { badges, stamp } = resolvePosterBadgeStamp(
    input.crawlerData,
    input.fileInfo,
    input.localState,
    input.config.download,
  );
  let drawn = "";
  if (badges.length > 0) {
    throwIfAborted(input.signal);
    input.signalService?.showLogText(`[${input.fileInfo.number}] Applying poster tag badges...`);

    try {
      const watermarkService = input.watermarkService ?? new PosterWatermarkService({ dataDir: input.dataDir });
      await watermarkService.applyTagBadges(posterPath, badges, {
        imageOverrides: input.config.download.tagBadgeImageOverrides,
        insetPercent: input.config.download.tagBadgeInsetPercent,
        onWarn: (message) => input.logger.warn(message),
        opacity: input.config.download.tagBadgeOpacity,
        position: input.config.download.tagBadgePosition,
        sizePercent: input.config.download.tagBadgeSizePercent,
      });
      drawn = stamp;
    } catch (error) {
      input.logger.warn(`Failed to apply poster tag badges for ${posterPath}: ${toErrorMessage(error)}`);
    }

    throwIfAborted(input.signal);
  }

  return { ...input.assets, posterBadges: { stamp: drawn, sha256: await hashPosterFile(posterPath) } };
};
