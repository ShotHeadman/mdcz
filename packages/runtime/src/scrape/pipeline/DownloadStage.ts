import { throwIfAborted } from "../utils/abort";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class DownloadStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    this.runtime.signalService.showScrapeInfo({
      fileInfo: context.fileInfo,
      site: context.requireCrawlerWebsite(),
      step: "download",
    });

    const downloadResult = await this.runtime.downloadCrawlerAssets(context, signal);

    throwIfAborted(signal);
    context.assets = downloadResult.assets;
    if (downloadResult.crawlerData) {
      context.preparedCrawlerData = downloadResult.crawlerData;
    }
    this.runtime.setProgress(context.progress, 75);
  }
}
