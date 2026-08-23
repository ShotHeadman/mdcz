import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { CrawlerData, DownloadedAssets, FileInfo, NfoLocalState } from "@mdcz/shared/types";
import { PosterWatermarkService } from "../PosterWatermarkService";
import type { RuntimeScrapeSignalService } from "../pipeline/types";
import { resolvePosterBadgeDefinitions } from "../posterBadges";
import { throwIfAborted } from "../utils/abort";

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
  if (!input.config.download.tagBadges) {
    return input.assets;
  }

  const posterPath = input.assets.poster;
  if (!posterPath || !input.assets.downloaded.includes(posterPath)) {
    return input.assets;
  }

  const badges = resolvePosterBadgeDefinitions(
    input.crawlerData,
    input.fileInfo,
    input.localState,
    input.config.download.tagBadgeTypes,
  );
  if (badges.length === 0) {
    return input.assets;
  }

  throwIfAborted(input.signal);
  input.signalService?.showLogText(`[${input.fileInfo.number}] Applying poster tag badges...`);

  try {
    const watermarkService = input.watermarkService ?? new PosterWatermarkService({ dataDir: input.dataDir });
    await watermarkService.applyTagBadges(posterPath, badges, input.config.download.tagBadgePosition, {
      imageOverrides: input.config.download.tagBadgeImageOverrides,
      onWarn: (message) => input.logger.warn(message),
    });
  } catch (error) {
    input.logger.warn(`Failed to apply poster tag badges for ${posterPath}: ${toErrorMessage(error)}`);
  }

  throwIfAborted(input.signal);
  return input.assets;
};
