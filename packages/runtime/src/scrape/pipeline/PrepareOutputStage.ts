import { throwIfAborted } from "../utils/abort";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class PrepareOutputStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    const preparedOutputData = await this.runtime.prepareOutputCrawlerData(context, signal);

    context.preparedCrawlerData = preparedOutputData.data;
    context.actorPhotoPaths = preparedOutputData.actorPhotoPaths;

    throwIfAborted(signal);
    this.runtime.setProgress(context.progress, 50);
  }
}
