import type { ScrapeResult } from "@shared/types";
import { throwIfAborted } from "../abort";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class AggregateStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    context.configuration ??= await this.runtime.getConfiguration();
    context.existingNfoLocalState = await this.runtime.loadExistingNfoLocalState(
      context.fileInfo.filePath,
      context.requireConfiguration(),
    );

    this.runtime.signalService.showLogText(`Starting scrape task ${context.taskId} for ${context.fileInfo.fileName}`);
    throwIfAborted(signal);

    this.runtime.signalService.showScrapeInfo({
      fileInfo: context.fileInfo,
      site: context.requireConfiguration().scrape.sites[0],
      step: "search",
    });

    context.aggregationResult = await this.runtime.aggregateMetadata(
      context.fileInfo,
      context.requireConfiguration(),
      signal,
    );
    throwIfAborted(signal);

    if (context.aggregationResult) {
      return;
    }

    this.runtime.setProgress(context.progress, 100);
    context.fileInfo = await this.runtime.handleFailedFileMove(context.fileInfo, context.requireConfiguration());

    const failedResult: ScrapeResult = {
      fileId: context.fileId,
      fileInfo: context.fileInfo,
      status: "failed",
      error: "No crawler returned metadata",
    };

    this.runtime.signalService.showScrapeResult(failedResult);
    this.runtime.signalService.showFailedInfo({
      fileInfo: context.fileInfo,
      error: "No crawler returned metadata",
    });
    context.result = failedResult;
  }
}
