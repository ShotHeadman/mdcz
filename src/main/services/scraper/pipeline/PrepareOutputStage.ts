import { throwIfAborted } from "../abort";
import { prepareOutputCrawlerData } from "../output";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class PrepareOutputStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    const configuration = context.requireConfiguration();
    const crawlerData = context.requireCrawlerData();
    const plan = context.requirePlan();
    const preparedOutputData = await prepareOutputCrawlerData({
      actorImageService: this.runtime.actorImageService,
      actorSourceProvider: this.runtime.actorSourceProvider,
      config: configuration,
      crawlerData,
      enabled: true,
      movieDir: plan.outputDir,
      sourceVideoPath: context.fileInfo.filePath,
      signal,
    });

    context.preparedCrawlerData = preparedOutputData.data;
    context.actorPhotoPaths = preparedOutputData.actorPhotoPaths;

    throwIfAborted(signal);
    this.runtime.setProgress(context.progress, 50);
  }
}
