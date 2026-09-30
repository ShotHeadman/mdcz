import { getDesktopUserDataPath } from "@main/appIdentity";
import type { SignalService } from "@main/services/SignalService";
import { applyPosterTagBadgesIfNeeded, PosterWatermarkService } from "@mdcz/runtime/scrape";
import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, DownloadedAssets, FileInfo, NfoLocalState } from "@mdcz/shared/types";
import type { Logger } from "winston";

const posterWatermarkService = new PosterWatermarkService({ dataDir: getDesktopUserDataPath() });

export const applyDesktopPosterTagBadges = async (input: {
  assets: DownloadedAssets;
  config: Pick<Configuration, "download">;
  crawlerData: CrawlerData;
  fileInfo: FileInfo;
  localState?: NfoLocalState;
  logger: Pick<Logger, "warn">;
  signal?: AbortSignal;
  signalService?: Pick<SignalService, "showLogText">;
}): Promise<DownloadedAssets> =>
  await applyPosterTagBadgesIfNeeded({
    ...input,
    dataDir: getDesktopUserDataPath(),
    watermarkService: posterWatermarkService,
  });
