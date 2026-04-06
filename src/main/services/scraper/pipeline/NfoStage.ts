import { throwIfAborted } from "../abort";
import { writePreparedNfo } from "../output";
import type { ScrapeContext } from "./ScrapeContext";
import type { FileScraperStageRuntime, ScrapeStage } from "./types";

export class NfoStage implements ScrapeStage {
  constructor(private readonly runtime: FileScraperStageRuntime) {}

  async execute(context: ScrapeContext, signal?: AbortSignal): Promise<void> {
    const configuration = context.requireConfiguration();
    const aggregationResult = context.requireAggregationResult();
    const crawlerData = context.requireCrawlerData();
    const plan = context.requirePlan();

    context.savedNfoPath = await writePreparedNfo({
      assets: context.assets ?? {
        downloaded: [],
        sceneImages: [],
      },
      config: configuration,
      crawlerData,
      enabled: configuration.download.generateNfo,
      fileInfo: context.fileInfo,
      keepExisting: configuration.download.keepNfo,
      localState: context.existingNfoLocalState,
      logger: this.runtime.logger,
      nfoGenerator: this.runtime.nfoGenerator,
      nfoPath: plan.nfoPath,
      sourceVideoPath: context.fileInfo.filePath,
      sources: aggregationResult.sources,
      videoMeta: context.videoMeta,
    });

    throwIfAborted(signal);
    this.runtime.setProgress(context.progress, 80);
  }
}
