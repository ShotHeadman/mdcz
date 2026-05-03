import { throwIfAborted } from "../utils/abort";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class TranslateStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    const aggregationResult = context.requireAggregationResult();
    const configuration = context.requireConfiguration();
    context.translatedCrawlerData = await this.runtime.translateCrawlerData(
      aggregationResult.data,
      configuration,
      signal,
    );
    throwIfAborted(signal);
  }
}
